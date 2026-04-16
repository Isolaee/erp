import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { analyzeTestRun } from '../services/testAnalysisService';

const router = Router();
router.use(verifyAccessToken);

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Verify the calling user is a member of the team that follows the given repo.
async function assertTeamAccess(userId: string, repoFollowId: string): Promise<void> {
  const follow = await prisma.repoFollow.findUnique({
    where: { id: repoFollowId },
    select: { team: { select: { members: { where: { userId }, select: { userId: true } } } } },
  });
  if (!follow) throw createError(404, 'Repo follow not found');
  if (follow.team.members.length === 0) throw createError(403, 'Not a member of this team');
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/testruns?repoFollowId=<id>&limit=20&offset=0
// List test runs for a followed repo, newest first.
router.get('/', async (req: Request, res: Response) => {
  const repoFollowId = Array.isArray(req.query.repoFollowId)
    ? (req.query.repoFollowId[0] as string)
    : (req.query.repoFollowId as string | undefined);
  if (!repoFollowId) throw createError(400, 'repoFollowId query param required');

  await assertTeamAccess(req.user!.id, repoFollowId);

  const limit  = Math.min(parseInt((req.query.limit  as string | undefined) ?? '20', 10), 100);
  const offset = parseInt((req.query.offset as string | undefined) ?? '0',  10);

  const [runs, total] = await Promise.all([
    prisma.testRun.findMany({
      where: { repoFollowId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        _count: { select: { testResults: true } },
      },
    }),
    prisma.testRun.count({ where: { repoFollowId } }),
  ]);

  // Serialize BigInt ghRunId as string for JSON
  const serialized = runs.map(serializeRun);
  res.json({ runs: serialized, total, limit, offset });
});

// GET /api/testruns/:id
// Get a single test run with its individual test results.
router.get('/:id', async (req: Request, res: Response) => {
  const run = await prisma.testRun.findUnique({
    where: { id: req.params.id as string },
    include: {
      testResults: { orderBy: { createdAt: 'asc' } },
      repoFollow:  { select: { id: true, owner: true, repo: true, teamId: true } },
    },
  });
  if (!run) throw createError(404, 'Test run not found');

  await assertTeamAccess(req.user!.id, run.repoFollowId);

  res.json(serializeRun(run));
});

// POST /api/testruns
// Manually trigger a new test run for a followed repo.
router.post('/', async (req: Request, res: Response) => {
  const { repoFollowId, branch } = req.body as { repoFollowId?: string; branch?: string };
  if (!repoFollowId) throw createError(400, 'repoFollowId is required');

  await assertTeamAccess(req.user!.id, repoFollowId);

  const follow = await prisma.repoFollow.findUnique({ where: { id: repoFollowId } });
  if (!follow) throw createError(404, 'Repo follow not found');

  const testRun = await prisma.testRun.create({
    data: {
      repoFollowId,
      status:  'PENDING',
      trigger: 'MANUAL',
      branch:  branch ?? null,
    },
  });

  analyzeTestRun(testRun.id).catch((err) => {
    console.error(`[testruns] analyzeTestRun failed for ${testRun.id}:`, err);
  });

  res.status(202).json(serializeRun(testRun));
});

// DELETE /api/testruns/:id   — cancel a pending/running test run
router.delete('/:id', async (req: Request, res: Response) => {
  const run = await prisma.testRun.findUnique({ where: { id: req.params.id as string } });
  if (!run) throw createError(404, 'Test run not found');

  await assertTeamAccess(req.user!.id, run.repoFollowId);

  if (run.status !== 'PENDING' && run.status !== 'RUNNING') {
    throw createError(409, 'Only PENDING or RUNNING test runs can be cancelled');
  }

  const updated = await prisma.testRun.update({
    where: { id: run.id },
    data: { status: 'CANCELLED', completedAt: new Date() },
  });

  res.json(serializeRun(updated));
});

// ─── Serializer ───────────────────────────────────────────────────────────────

function serializeRun(run: Record<string, any>): Record<string, unknown> {
  return {
    ...run,
    // BigInt is not JSON-serializable — convert to string
    ghRunId: run.ghRunId != null ? run.ghRunId.toString() : null,
  };
}

export default router;
