import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ListScope, ListVisibility, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { canUserAccessList, canUserWriteList } from '../services/accessControl';
import * as sse from '../services/sseService';

const router = Router();
router.use(verifyAccessToken);

// GET /api/lists — returns all lists visible to the current user
router.get('/', async (req: Request, res: Response) => {
  const { scope, teamId } = req.query as { scope?: string; teamId?: string };

  // Fetch candidate lists, then filter by access control
  const allLists = await prisma.taskList.findMany({
    where: {
      deletedAt: null,
      ...(scope && { scope: scope as ListScope }),
      ...(teamId && { teamId }),
    },
    include: {
      ownerUser: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      _count: { select: { tasks: { where: { deletedAt: null } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const visible = await Promise.all(
    allLists.map(async (l) => ({ list: l, can: await canUserAccessList(req.user!.id, l.id) })),
  );
  res.json(visible.filter((x) => x.can).map((x) => x.list));
});

// POST /api/lists
router.post('/', async (req: Request, res: Response) => {
  const body = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    scope: z.nativeEnum(ListScope),
    visibility: z.nativeEnum(ListVisibility).optional().default(ListVisibility.PRIVATE),
    teamId: z.string().min(1).optional(),
  }).parse(req.body);

  if (body.scope === ListScope.TEAM && !body.teamId) {
    throw createError(400, 'teamId required for TEAM scope lists');
  }

  const list = await prisma.taskList.create({
    data: { ...body, ownerId: req.user!.id },
    include: { ownerUser: { select: { id: true, name: true } }, team: { select: { id: true, name: true } } },
  });
  res.status(201).json(list);
});

// GET /api/lists/:id
router.get('/:id', async (req: Request, res: Response) => {
  if (!(await canUserAccessList(req.user!.id, req.params.id))) throw createError(403, 'Forbidden');

  const list = await prisma.taskList.findUnique({
    where: { id: req.params.id, deletedAt: null },
    include: {
      ownerUser: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      tasks: {
        where: { deletedAt: null, parentId: null },
        orderBy: { order: 'asc' },
        include: {
          subtasks: { where: { deletedAt: null }, orderBy: { order: 'asc' } },
          assignments: {
            include: { assignee: { select: { id: true, name: true, avatarUrl: true } } },
          },
          creator: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!list) throw createError(404, 'List not found');
  res.json(list);
});

// PATCH /api/lists/:id
router.patch('/:id', async (req: Request, res: Response) => {
  if (!(await canUserWriteList(req.user!.id, req.params.id))) throw createError(403, 'Forbidden');

  const body = z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    visibility: z.nativeEnum(ListVisibility).optional(),
  }).parse(req.body);

  const list = await prisma.taskList.update({ where: { id: req.params.id }, data: body });
  res.json(list);
});

// DELETE /api/lists/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const list = await prisma.taskList.findUnique({ where: { id: req.params.id } });
  if (!list) throw createError(404, 'List not found');

  const canDelete = req.user!.role === UserRole.ADMIN || list.ownerId === req.user!.id;
  if (!canDelete) throw createError(403, 'Forbidden');

  await prisma.taskList.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  res.status(204).end();
});

export default router;
