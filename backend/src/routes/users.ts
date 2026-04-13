import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { createError } from '../middleware/errorHandler';

const router = Router();
router.use(verifyAccessToken);

// GET /api/users
router.get('/', requireRole(UserRole.TEAM_LEAD), async (req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, email: true, name: true, role: true, avatarUrl: true, createdAt: true },
    orderBy: { name: 'asc' },
  });
  res.json(users);
});

// GET /api/users/:id
router.get('/:id', async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id, deletedAt: null },
    select: {
      id: true, email: true, name: true, role: true, avatarUrl: true, createdAt: true,
      teamMemberships: { include: { team: { select: { id: true, name: true } } } },
    },
  });
  if (!user) throw createError(404, 'User not found');
  res.json(user);
});

// PATCH /api/users/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const isSelf = req.user!.id === req.params.id;
  const isAdmin = req.user!.role === UserRole.ADMIN;
  if (!isSelf && !isAdmin) throw createError(403, 'Forbidden');

  const body = z.object({
    name: z.string().min(1).optional(),
    avatarUrl: z.string().url().optional(),
  }).parse(req.body);

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: body,
    select: { id: true, email: true, name: true, role: true, avatarUrl: true },
  });
  res.json(user);
});

// DELETE /api/users/:id
router.delete('/:id', requireRole(UserRole.ADMIN), async (req: Request, res: Response) => {
  if (req.user!.id === req.params.id) throw createError(400, 'Cannot delete yourself');
  await prisma.user.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  res.status(204).end();
});

export default router;
