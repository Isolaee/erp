import { Router, Request, Response } from 'express';
import express from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { emit } from '../services/sseService';
import { analyzeTestRun } from '../services/testAnalysisService';
import { COMMIT_MESSAGE_PREFIX } from '../services/testWriterService';
import { TestRunTrigger } from '@prisma/client';

const router = Router();

// Raw body required for HMAC-SHA256 signature validation against X-Hub-Signature-256.
// This middleware must run before any JSON parsing on this router.
router.use(express.raw({ type: 'application/json' }));

function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!config.GITHUB_WEBHOOK_SECRET) {
    // No secret configured — skip validation (dev convenience, warn loudly)
    console.warn('[webhook] GITHUB_WEBHOOK_SECRET not set — skipping signature check');
    return true;
  }
  if (!signatureHeader) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', config.GITHUB_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

// POST /api/webhooks/github
router.post('/github', async (req: Request, res: Response) => {
  const rawBody = req.body as Buffer;
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const event = req.headers['x-github-event'] as string | undefined;
  const deliveryId = req.headers['x-github-delivery'] as string | undefined;

  if (!verifySignature(rawBody, signature)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }

  // Acknowledge immediately — processing is async
  res.status(202).json({ accepted: true, delivery: deliveryId });

  // Process without blocking the response
  handleWebhookEvent(event ?? '', payload).catch((err) => {
    console.error('[webhook] Unhandled error processing event', event, err);
  });
});

async function handleWebhookEvent(event: string, payload: Record<string, any>) {
  if (event !== 'push' && event !== 'pull_request') return;

  const repoOwner: string | undefined = payload.repository?.owner?.login;
  const repoName: string | undefined = payload.repository?.name;
  if (!repoOwner || !repoName) return;

  // Find all RepoFollow records that track this repo and have AI testing enabled
  const follows = await prisma.repoFollow.findMany({
    where: { owner: repoOwner, repo: repoName, aiTestingEnabled: true },
    include: { team: { include: { members: { select: { userId: true } } } } },
  });
  if (follows.length === 0) return;

  const trigger: TestRunTrigger = event === 'pull_request' ? 'PULL_REQUEST' : 'PUSH';

  // Extract commit context
  let branch: string | undefined;
  let commitSha: string | undefined;
  let commitMessage: string | undefined;
  let prNumber: number | undefined;

  if (event === 'push') {
    branch = (payload.ref as string | undefined)?.replace('refs/heads/', '');
    commitSha = payload.after;
    commitMessage = payload.head_commit?.message;

    // Skip commits made by our own test-writer agent to avoid an infinite trigger loop
    if (commitMessage?.startsWith(COMMIT_MESSAGE_PREFIX)) {
      console.log(`[webhook] Skipping test-update commit on ${branch}`);
      return;
    }
  } else if (event === 'pull_request') {
    branch = payload.pull_request?.head?.ref;
    commitSha = payload.pull_request?.head?.sha;
    commitMessage = payload.pull_request?.title;
    prNumber = payload.pull_request?.number;
  }

  for (const follow of follows) {
    const testRun = await prisma.testRun.create({
      data: {
        repoFollowId: follow.id,
        status: 'PENDING',
        trigger,
        branch,
        commitSha,
        commitMessage,
        prNumber,
      },
    });

    console.log(`[webhook] Created TestRun ${testRun.id} for ${repoOwner}/${repoName} (${event})`);

    // Notify all team members via SSE
    for (const member of follow.team.members) {
      emit(member.userId, 'testRun.created', {
        testRunId: testRun.id,
        repoFollowId: follow.id,
        owner: repoOwner,
        repo: repoName,
        trigger,
        branch,
        commitSha,
        status: 'PENDING',
      });
    }

    // Kick off AI analysis asynchronously — does not block webhook response
    analyzeTestRun(testRun.id).catch((err) => {
      console.error(`[webhook] analyzeTestRun failed for ${testRun.id}:`, err);
    });
  }
}

export default router;
