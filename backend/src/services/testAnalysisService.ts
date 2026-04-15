import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { emit } from './sseService';
import { getCommitFiles, getPullRequestFiles } from './githubService';
import { triggerTestExecution } from './testExecutionService';

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// Max diff size sent to Claude — large diffs get truncated to stay within token budget.
const MAX_DIFF_CHARS = 80_000;

const SYSTEM_PROMPT = `You are a code review assistant that analyses git diffs to determine whether a project's test suite needs updating.

Given a diff, respond with a JSON object — no prose outside the JSON:
{
  "needsUpdate": true | false,
  "reason": "one sentence explaining your decision",
  "suggestions": ["specific change 1", "specific change 2"]
}

Guidelines:
- needsUpdate = true  when: new public functions/methods are added, existing behaviour changes, bug fixes that should be regression-tested, or API contracts change.
- needsUpdate = false when: changes are purely to comments, docs, formatting, config files, or internal refactors with no observable behaviour change.
- Keep suggestions concrete and actionable (e.g. "Add test for getUserById returning 404 when user is deleted").`;

interface AnalysisResult {
  needsUpdate: boolean;
  reason: string;
  suggestions: string[];
}

// ─── Diff builder ─────────────────────────────────────────────────────────────

type FileEntry = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
};

function buildDiffText(files: FileEntry[]): string {
  const parts: string[] = [];

  for (const f of files) {
    const header = `### ${f.status.toUpperCase()} ${f.filename} (+${f.additions}/-${f.deletions})`;
    const patch = f.patch ? '```diff\n' + f.patch + '\n```' : '(binary or too large)';
    parts.push(header + '\n' + patch);
  }

  const full = parts.join('\n\n');
  if (full.length <= MAX_DIFF_CHARS) return full;

  // Truncate and append a note so Claude knows it's partial
  return full.slice(0, MAX_DIFF_CHARS) + '\n\n... [diff truncated — showing first 80 000 characters]';
}

// ─── Token resolution (mirrors github.ts helper) ─────────────────────────────

async function resolveToken(repoFollowId: string): Promise<string | null> {
  const follow = await prisma.repoFollow.findUnique({
    where: { id: repoFollowId },
    select: { team: { select: { githubPat: true } } },
  });
  return follow?.team?.githubPat ?? config.GITHUB_TOKEN ?? null;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function analyzeTestRun(testRunId: string): Promise<void> {
  // Load run + follow + team members (for SSE)
  const testRun = await prisma.testRun.findUnique({
    where: { id: testRunId },
    include: {
      repoFollow: {
        include: {
          team: { include: { members: { select: { userId: true } } } },
        },
      },
    },
  });

  if (!testRun) {
    console.warn(`[testAnalysis] TestRun ${testRunId} not found`);
    return;
  }

  const { repoFollow } = testRun;
  const { owner, repo } = repoFollow;
  const teamMembers = repoFollow.team.members;

  // Mark as running
  await prisma.testRun.update({
    where: { id: testRunId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  // ── Fetch diff from GitHub ──────────────────────────────────────────────────
  let diffText = '';
  try {
    const token = await resolveToken(repoFollow.id);

    let files: FileEntry[] = [];
    if (testRun.trigger === 'PULL_REQUEST' && testRun.prNumber) {
      files = await getPullRequestFiles(owner, repo, testRun.prNumber, token);
    } else if (testRun.commitSha) {
      files = await getCommitFiles(owner, repo, testRun.commitSha, token);
    }

    diffText = buildDiffText(files);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[testAnalysis] Failed to fetch diff for ${testRunId}:`, msg);
    diffText = `(diff unavailable: ${msg})`;
  }

  // ── Ask Claude ──────────────────────────────────────────────────────────────
  const userContent = [
    `Repository: ${owner}/${repo}`,
    testRun.branch ? `Branch: ${testRun.branch}` : null,
    testRun.commitSha ? `Commit: ${testRun.commitSha}` : null,
    testRun.commitMessage ? `Message: ${testRun.commitMessage}` : null,
    '',
    diffText || '(no diff available)',
  ]
    .filter((l) => l !== null)
    .join('\n');

  let result: AnalysisResult = {
    needsUpdate: false,
    reason: 'Analysis could not be completed.',
    suggestions: [],
  };
  let aiAnalysisRaw = '';

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          // Cache the static system prompt — it never changes between runs
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userContent }],
    });

    aiAnalysisRaw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    // Claude is instructed to return only JSON, but strip any accidental wrapping
    const jsonMatch = aiAnalysisRaw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      result = JSON.parse(jsonMatch[0]) as AnalysisResult;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[testAnalysis] Claude call failed for ${testRunId}:`, msg);
    aiAnalysisRaw = JSON.stringify({ ...result, reason: `Analysis error: ${msg}` });
  }

  // ── Persist analysis result ─────────────────────────────────────────────────
  await prisma.testRun.update({
    where: { id: testRunId },
    data: {
      aiNeedsUpdate: result.needsUpdate,
      aiAnalysis: aiAnalysisRaw,
    },
  });

  console.log(
    `[testAnalysis] ${testRunId} — needsUpdate=${result.needsUpdate} | ${result.reason}`,
  );

  // ── Notify team via SSE ─────────────────────────────────────────────────────
  for (const member of teamMembers) {
    emit(member.userId, 'testRun.analyzed', {
      testRunId,
      repoFollowId: repoFollow.id,
      owner,
      repo,
      aiNeedsUpdate: result.needsUpdate,
      reason: result.reason,
      suggestions: result.suggestions,
    });
  }

  // For MANUAL triggers, GitHub won't auto-run CI — dispatch the workflow ourselves.
  // PUSH/PR triggers: GitHub Actions already fires from the event; we await workflow_run webhook.
  if (testRun.trigger === 'MANUAL') {
    triggerTestExecution(testRunId).catch((err) => {
      console.error(`[testAnalysis] triggerTestExecution failed for ${testRunId}:`, err);
    });
  }
}
