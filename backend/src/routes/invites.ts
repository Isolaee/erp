import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { createError } from '../middleware/errorHandler';

const router = Router();

// GET /api/invites/:token/preview — public
router.get('/:token/preview', async (req: Request, res: Response) => {
  const invite = await prisma.invite.findUnique({
    where: { token: req.params.token },
    include: {
      sender: { select: { name: true, email: true } },
      team: { select: { name: true } },
    },
  });
  if (!invite || invite.status !== 'PENDING' || invite.expiresAt < new Date()) {
    throw createError(404, 'Invite not found or expired');
  }
  res.json({
    email: invite.email,
    role: invite.role,
    teamName: invite.team?.name ?? null,
    senderName: invite.sender.name,
    expiresAt: invite.expiresAt,
  });
});

// POST /api/invites/:token/accept — public (register handled in auth.ts)
// Kept here as redirect but actual logic is in POST /api/auth/register
router.post('/:token/accept', async (req: Request, res: Response) => {
  res.redirect(307, '/api/auth/register');
});

// Protected routes below
router.use(verifyAccessToken);

// POST /api/invites
router.post('/', requireRole(UserRole.TEAM_LEAD), async (req: Request, res: Response) => {
  const body = z.object({
    email: z.string().email().optional(),
    teamId: z.string().uuid().optional(),
    role: z.nativeEnum(UserRole).optional().default(UserRole.MEMBER),
  }).parse(req.body);

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const invite = await prisma.invite.create({
    data: { ...body, senderId: req.user!.id, expiresAt },
    include: { team: { select: { name: true } } },
  });

  const inviteUrl = `${process.env.FRONTEND_URL}/register/${invite.token}`;
  res.status(201).json({ ...invite, inviteUrl });
});

// GET /api/invites
router.get('/', requireRole(UserRole.TEAM_LEAD), async (req: Request, res: Response) => {
  const where = req.user!.role === UserRole.ADMIN
    ? {}
    : { team: { members: { some: { userId: req.user!.id, role: { in: [UserRole.TEAM_LEAD, UserRole.ADMIN] } } } } };

  const invites = await prisma.invite.findMany({
    where,
    include: {
      sender: { select: { name: true } },
      team: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(invites);
});

// DELETE /api/invites/:id
router.delete('/:id', requireRole(UserRole.TEAM_LEAD), async (req: Request, res: Response) => {
  await prisma.invite.update({
    where: { id: req.params.id },
    data: { status: 'REVOKED' },
  });
  res.status(204).end();
});

export default router;
