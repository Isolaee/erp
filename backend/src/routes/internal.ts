/**
 * Internal routes — called by the test-runner container, never by the browser.
 * Protected by INTERNAL_SECRET header instead of a JWT.
 */
import { Router, Request, Response } from 'express';
import { TestRunStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { emit } from '../services/sseService';
import { createError } from '../middleware/errorHandler';

const router = Router();

// Verify the shared secret on every request to this router
router.use((req, _res, next) => {
  if (req.headers['x-internal-secret'] !== config.INTERNAL_SECRET) {
    throw createError(401, 'Unauthorized');
  }
  next();
});

// ─── Types mirroring test-runner/src/runner.ts ────────────────────────────────

interface TestCase {
  suiteName: string;
  testName: string;
  status: 'passed' | 'failed' | 'skipped';
  duration?: number;
  errorMessage?: string;
  errorStack?: string;
}

interface SuiteResult {
  suite: 'backend' | 'frontend';
  passed: boolean;
  tests: TestCase[];
  error?: string;
}

interface RunResult {
  passed: boolean;
  suites: SuiteResult[];
}

// POST /api/internal/test-complete/:id
// Called by the test-runner service when a job finishes.
router.post('/test-complete/:id', async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const { result, error: runError } = req.body as { result: RunResult; error?: string };

  const testRun = await prisma.testRun.findUnique({
    where: { id },
    include: {
      repoFollow: {
        include: { team: { include: { members: { select: { userId: true } } } } },
      },
    },
  });

  if (!testRun) {
    res.status(404).json({ error: 'TestRun not found' });
    return;
  }

  const finalStatus: TestRunStatus = result.passed ? 'PASSED' : 'FAILED';

  // Persist overall run status
  const existingAnalysis = (() => {
    try { return JSON.parse(testRun.aiAnalysis ?? '{}'); } catch { return {}; }
  })();

  await prisma.testRun.update({
    where: { id },
    data: {
      status: runError ? 'ERROR' : finalStatus,
      completedAt: new Date(),
      aiAnalysis: JSON.stringify({
        ...existingAnalysis,
        ...(runError ? { executionError: runError } : {}),
      }),
    },
  });

  // Persist individual test results
  const testResultRows = result.suites.flatMap((s) =>
    s.tests.map((t) => ({
      testRunId: id,
      suiteName: `[${s.suite}] ${t.suiteName}`,
      testName: t.testName,
      status: mapStatus(t.status),
      duration: t.duration ?? null,
      errorMessage: t.errorMessage ?? null,
      errorStack: t.errorStack ?? null,
    })),
  );

  if (testResultRows.length > 0) {
    await prisma.testResult.createMany({ data: testResultRows });
  }

  // Notify all team members via SSE
  const { repoFollow } = testRun;
  for (const member of repoFollow.team.members) {
    emit(member.userId, 'testRun.completed', {
      testRunId: id,
      repoFollowId: repoFollow.id,
      owner: repoFollow.owner,
      repo: repoFollow.repo,
      status: finalStatus,
      passed: result.passed,
      suites: result.suites.map((s) => ({
        suite: s.suite,
        passed: s.passed,
        total: s.tests.length,
        failed: s.tests.filter((t) => t.status === 'failed').length,
        error: s.error,
      })),
    });
  }

  console.log(
    `[internal] TestRun ${id} completed — ${finalStatus}`,
    result.suites.map((s) => `${s.suite}:${s.passed ? 'PASS' : 'FAIL'}`).join(' '),
  );

  res.json({ ok: true });
});

function mapStatus(s: 'passed' | 'failed' | 'skipped'): TestRunStatus {
  if (s === 'passed') return 'PASSED';
  if (s === 'skipped') return 'CANCELLED'; // closest enum value for skipped
  return 'FAILED';
}

export default router;
