import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import * as github from '../services/githubService';

const router = Router();
router.use(verifyAccessToken);

// Token resolution priority:
//   1. Team-level PAT stored on the RepoFollow's team (set by team leads in repo settings)
//   2. Calling user's personal GitHub token (set via OAuth or profile)
//   3. Fallback: global GITHUB_TOKEN env var (handled inside githubService)
async function resolveToken(userId: string, owner: string, repo: string): Promise<string | null> {
  const follow = await prisma.repoFollow.findFirst({
    where: { owner, repo },
    select: { team: { select: { githubPat: true } } },
  });
  if (follow?.team?.githubPat) return follow.team.githubPat;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { githubToken: true } });
  return user?.githubToken ?? null;
}

router.get('/repos/:owner/:repo', async (req: Request, res: Response) => {
  const token = await resolveToken(req.user!.id, req.params.owner, req.params.repo);
  const data = await github.getRepo(req.params.owner, req.params.repo, token).catch(() => {
    throw createError(404, 'Repository not found or access denied');
  });
  res.json(data);
});

router.get('/repos/:owner/:repo/issues', async (req: Request, res: Response) => {
  const token = await resolveToken(req.user!.id, req.params.owner, req.params.repo);
  const page = parseInt(req.query.page as string ?? '1', 10);
  const data = await github.getIssues(req.params.owner, req.params.repo, page, token);
  res.json(data);
});

router.get('/repos/:owner/:repo/pulls', async (req: Request, res: Response) => {
  const token = await resolveToken(req.user!.id, req.params.owner, req.params.repo);
  const page = parseInt(req.query.page as string ?? '1', 10);
  const data = await github.getPulls(req.params.owner, req.params.repo, page, token);
  res.json(data);
});

router.get('/repos/:owner/:repo/commits', async (req: Request, res: Response) => {
  const token = await resolveToken(req.user!.id, req.params.owner, req.params.repo);
  const page = parseInt(req.query.page as string ?? '1', 10);
  const data = await github.getCommits(req.params.owner, req.params.repo, page, token);
  res.json(data);
});

export default router;
