import { Octokit } from '@octokit/rest';
import { TestRunStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { emit } from './sseService';
import { getRepo } from './githubService';

function makeOctokit(token?: string | null): Octokit {
  return new Octokit({ auth: token ?? config.GITHUB_TOKEN ?? undefined });
}

async function resolveToken(repoFollowId: string): Promise<string | null> {
  const follow = await prisma.repoFollow.findUnique({
    where: { id: repoFollowId },
    select: { team: { select: { githubPat: true } } },
  });
  return follow?.team?.githubPat ?? config.GITHUB_TOKEN ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Set status ERROR without clobbering the existing aiAnalysis from the analysis step.
// Merges executionError into the JSON so the UI can display both.
async function markExecutionError(testRunId: string, reason: string): Promise<void> {
  const run = await prisma.testRun.findUnique({
    where: { id: testRunId },
    select: { aiAnalysis: true },
  });

  let merged: Record<string, unknown> = { executionError: reason };
  if (run?.aiAnalysis) {
    try {
      const existing = JSON.parse(run.aiAnalysis);
      merged = { ...existing, executionError: reason };
    } catch {
      // existing aiAnalysis wasn't JSON — keep it as a field
      merged = { rawAnalysis: run.aiAnalysis, executionError: reason };
    }
  }

  await prisma.testRun.update({
    where: { id: testRunId },
    data: { status: 'ERROR', completedAt: new Date(), aiAnalysis: JSON.stringify(merged) },
  });
}

// Map a GitHub Actions workflow_run conclusion/status → our TestRunStatus
function mapConclusion(conclusion: string | null, status: string): TestRunStatus {
  if (status === 'in_progress' || status === 'queued' || status === 'waiting') return 'RUNNING';
  switch (conclusion) {
    case 'success':   return 'PASSED';
    case 'failure':   return 'FAILED';
    case 'cancelled': return 'CANCELLED';
    default:          return 'ERROR';
  }
}

// ─── Manual trigger ───────────────────────────────────────────────────────────
// Finds a dispatchable CI workflow in the repo, triggers it, and polls briefly
// to capture the new GitHub Actions run ID/URL on the TestRun record.

export async function triggerTestExecution(testRunId: string): Promise<void> {
  const testRun = await prisma.testRun.findUnique({
    where: { id: testRunId },
    include: {
      repoFollow: {
        include: { team: { include: { members: { select: { userId: true } } } } },
      },
    },
  });
  if (!testRun) return;

  const { repoFollow } = testRun;
  const { owner, repo } = repoFollow;
  const token = await resolveToken(repoFollow.id);
  const octokit = makeOctokit(token);

  // Use stored branch, or fall back to the repo's actual default branch
  let branch = testRun.branch;
  if (!branch) {
    try {
      const repoInfo = await getRepo(owner, repo, token);
      branch = repoInfo.defaultBranch;
    } catch {
      branch = 'main';
    }
  }

  // Find a workflow that looks like CI/tests
  let workflowId: number | undefined;
  try {
    const { data } = await octokit.actions.listRepoWorkflows({ owner, repo });
    const preferred = data.workflows.find((w) =>
      /\b(ci|test|check|build)\b/i.test(w.name) ||
      /\b(ci|test|check|build)\b/i.test(w.path),
    );
    workflowId = preferred?.id ?? data.workflows[0]?.id;
  } catch (err) {
    console.error(`[testExecution] Failed to list workflows for ${owner}/${repo}:`, err);
  }

  if (!workflowId) {
    await markExecutionError(testRunId, 'No dispatchable workflow found in repository. Add a workflow with workflow_dispatch trigger, or set GITHUB_TOKEN.');
    return;
  }

  // Dispatch the workflow
  try {
    await octokit.actions.createWorkflowDispatch({
      owner, repo, workflow_id: workflowId, ref: branch,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[testExecution] Dispatch failed for ${owner}/${repo}:`, msg);
    await markExecutionError(testRunId, `Workflow dispatch failed: ${msg}`);
    return;
  }

  // Poll up to ~15 s for the new run to appear so we can store the run ID
  let ghRunId: bigint | undefined;
  let ghRunUrl: string | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(3_000);
    try {
      const { data } = await octokit.actions.listWorkflowRuns({
        owner, repo, workflow_id: workflowId, branch, per_page: 5,
      });
      const newest = data.workflow_runs[0];
      if (newest) {
        ghRunId = BigInt(newest.id);
        ghRunUrl = newest.html_url;
        break;
      }
    } catch {
      // transient — try again
    }
  }

  await prisma.testRun.update({
    where: { id: testRunId },
    data: {
      status: 'RUNNING',
      startedAt: new Date(),
      ...(ghRunId  && { ghRunId }),
      ...(ghRunUrl && { ghRunUrl }),
    },
  });

  for (const member of repoFollow.team.members) {
    emit(member.userId, 'testRun.triggered', {
      testRunId,
      owner,
      repo,
      ghRunId:  ghRunId?.toString(),
      ghRunUrl,
    });
  }

  console.log(`[testExecution] Triggered run for ${owner}/${repo} — gh run ${ghRunId}`);
}

// ─── workflow_run webhook handler ─────────────────────────────────────────────
// Called when GitHub sends a workflow_run event (action: in_progress | completed).
// Matches TestRuns by repo + head commit SHA and updates their status.

export async function handleWorkflowRunEvent(
  owner:      string,
  repo:       string,
  ghRunId:    number,
  headSha:    string,
  conclusion: string | null,
  runUrl:     string,
  ghStatus:   string,
): Promise<void> {
  const follows = await prisma.repoFollow.findMany({
    where: { owner, repo },
    select: { id: true, team: { select: { members: { select: { userId: true } } } } },
  });
  if (follows.length === 0) return;

  const followIds = follows.map((f) => f.id);
  const mappedStatus = mapConclusion(conclusion, ghStatus);

  const testRuns = await prisma.testRun.findMany({
    where: {
      repoFollowId: { in: followIds },
      commitSha:    headSha,
      status:       { in: ['PENDING', 'RUNNING'] },
    },
  });
  if (testRuns.length === 0) return;

  for (const run of testRuns) {
    const isTerminal = mappedStatus !== 'RUNNING';
    await prisma.testRun.update({
      where: { id: run.id },
      data: {
        status:    mappedStatus,
        ghRunId:   BigInt(ghRunId),
        ghRunUrl:  runUrl,
        ...(isTerminal && { completedAt: new Date() }),
      },
    });

    const follow = follows.find((f) => f.id === run.repoFollowId);
    if (!follow) continue;

    const sseEvent = isTerminal ? 'testRun.completed' : 'testRun.running';
    for (const member of follow.team.members) {
      emit(member.userId, sseEvent, {
        testRunId: run.id,
        owner,
        repo,
        status:   mappedStatus,
        ghRunId:  ghRunId.toString(),
        ghRunUrl: runUrl,
      });
    }

    console.log(`[testExecution] TestRun ${run.id} → ${mappedStatus} (gh run ${ghRunId})`);
  }
}
