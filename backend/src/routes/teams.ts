import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { createError } from '../middleware/errorHandler';

const router = Router();
router.use(verifyAccessToken);

// Strip the raw PAT value from any team object before sending it over the wire.
// Returns a `hasGithubPat` boolean so the UI can show the "configured" badge
// without ever exposing the token itself.
function sanitizeTeam<T extends { githubPat?: string | null }>(
  team: T,
): Omit<T, 'githubPat'> & { hasGithubPat: boolean } {
  const { githubPat, ...rest } = team;
  return { ...rest, hasGithubPat: !!githubPat };
}

// GET /api/teams
router.get('/', async (req: Request, res: Response) => {
  const where = req.user!.role === UserRole.ADMIN
    ? { deletedAt: null }
    : { deletedAt: null, members: { some: { userId: req.user!.id } } };

  const teams = await prisma.team.findMany({
    where,
    include: { _count: { select: { members: true } } },
    orderBy: { name: 'asc' },
  });
  res.json(teams.map(sanitizeTeam));
});

// POST /api/teams
router.post('/', requireRole(UserRole.ADMIN), async (req: Request, res: Response) => {
  const body = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
  }).parse(req.body);

  const team = await prisma.team.create({
    data: {
      ...body,
      members: { create: { userId: req.user!.id, role: UserRole.ADMIN } },
    },
  });
  res.status(201).json(sanitizeTeam(team));
});

// GET /api/teams/:id
router.get('/:id', async (req: Request, res: Response) => {
  const team = await prisma.team.findUnique({
    where: { id: req.params.id, deletedAt: null },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true, role: true, avatarUrl: true } } },
      },
      repoFollows: true,
    },
  });
  if (!team) throw createError(404, 'Team not found');

  const isMember = team.members.some((m) => m.userId === req.user!.id);
  if (!isMember && req.user!.role !== UserRole.ADMIN) throw createError(403, 'Forbidden');

  res.json(sanitizeTeam(team));
});

// PATCH /api/teams/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const membership = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId: req.user!.id, teamId: req.params.id } },
  });
  const canEdit = req.user!.role === UserRole.ADMIN ||
    (membership && membership.role !== UserRole.MEMBER);
  if (!canEdit) throw createError(403, 'Forbidden');

  const body = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
  }).parse(req.body);

  const team = await prisma.team.update({ where: { id: req.params.id }, data: body });
  res.json(sanitizeTeam(team));
});

// DELETE /api/teams/:id
router.delete('/:id', requireRole(UserRole.ADMIN), async (req: Request, res: Response) => {
  await prisma.team.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  res.status(204).end();
});

// PUT /api/teams/:id/github-pat
// Save or clear the team-level GitHub PAT used for all repo API calls.
// Send { pat: null } to remove an existing PAT.
router.put('/:id/github-pat', async (req: Request, res: Response) => {
  const membership = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId: req.user!.id, teamId: req.params.id } },
  });
  const canManage = req.user!.role === UserRole.ADMIN ||
    (membership && membership.role !== UserRole.MEMBER);
  if (!canManage) throw createError(403, 'Forbidden');

  const body = z.object({
    // null clears the PAT; a non-empty string sets it
    pat: z.string().min(1).nullable(),
  }).parse(req.body);

  await prisma.team.update({
    where: { id: req.params.id },
    data: { githubPat: body.pat },
  });

  res.json({ hasGithubPat: body.pat !== null });
});

// GET /api/teams/:id/members
router.get('/:id/members', async (req: Request, res: Response) => {
  const membership = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId: req.user!.id, teamId: req.params.id } },
  });
  if (!membership && req.user!.role !== UserRole.ADMIN) throw createError(403, 'Forbidden');

  const members = await prisma.teamMember.findMany({
    where: { teamId: req.params.id },
    include: { user: { select: { id: true, name: true, email: true, role: true, avatarUrl: true } } },
  });
  res.json(members);
});

// POST /api/teams/:id/members
router.post('/:id/members', requireRole(UserRole.TEAM_LEAD), async (req: Request, res: Response) => {
  const body = z.object({
    userId: z.string().uuid(),
    role: z.nativeEnum(UserRole).optional().default(UserRole.MEMBER),
  }).parse(req.body);

  const member = await prisma.teamMember.create({
    data: { teamId: req.params.id, ...body },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  res.status(201).json(member);
});

// PATCH /api/teams/:id/members/:uid
router.patch('/:id/members/:uid', requireRole(UserRole.TEAM_LEAD), async (req: Request, res: Response) => {
  const body = z.object({ role: z.nativeEnum(UserRole) }).parse(req.body);
  const member = await prisma.teamMember.update({
    where: { userId_teamId: { userId: req.params.uid, teamId: req.params.id } },
    data: body,
  });
  res.json(member);
});

// DELETE /api/teams/:id/members/:uid
router.delete('/:id/members/:uid', requireRole(UserRole.TEAM_LEAD), async (req: Request, res: Response) => {
  await prisma.teamMember.delete({
    where: { userId_teamId: { userId: req.params.uid, teamId: req.params.id } },
  });
  res.status(204).end();
});

// GET /api/teams/:id/repos
router.get('/:id/repos', async (req: Request, res: Response) => {
  const membership = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId: req.user!.id, teamId: req.params.id } },
  });
  if (!membership && req.user!.role !== UserRole.ADMIN) throw createError(403, 'Forbidden');

  const repos = await prisma.repoFollow.findMany({ where: { teamId: req.params.id } });
  res.json(repos);
});

// POST /api/teams/:id/repos
router.post('/:id/repos', requireRole(UserRole.TEAM_LEAD), async (req: Request, res: Response) => {
  const body = z.object({ owner: z.string().min(1), repo: z.string().min(1) }).parse(req.body);
  const follow = await prisma.repoFollow.create({
    data: { teamId: req.params.id, addedByUserId: req.user!.id, ...body },
  });
  res.status(201).json(follow);
});

// PATCH /api/teams/:id/repos/:repoId
// Toggle per-repo settings. Currently only aiTestingEnabled is patchable.
router.patch('/:id/repos/:repoId', async (req: Request, res: Response) => {
  const membership = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId: req.user!.id, teamId: req.params.id } },
  });
  const canManage = req.user!.role === UserRole.ADMIN ||
    (membership && membership.role !== UserRole.MEMBER);
  if (!canManage) throw createError(403, 'Forbidden');

  const body = z.object({
    aiTestingEnabled: z.boolean().optional(),
  }).parse(req.body);

  const follow = await prisma.repoFollow.update({
    where: { id: req.params.repoId },
    data: body,
  });
  res.json(follow);
});

// DELETE /api/teams/:id/repos/:repoId
router.delete('/:id/repos/:repoId', requireRole(UserRole.TEAM_LEAD), async (req: Request, res: Response) => {
  await prisma.repoFollow.delete({ where: { id: req.params.repoId } });
  res.status(204).end();
});

export default router;
