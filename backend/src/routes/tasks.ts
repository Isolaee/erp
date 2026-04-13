import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { TaskPriority, TaskStatus, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { canUserAccessList, canUserWriteList, canUserAccessTask } from '../services/accessControl';
import * as sse from '../services/sseService';

const router = Router();
router.use(verifyAccessToken);

// GET /api/tasks
router.get('/', async (req: Request, res: Response) => {
  const { listId, assigneeId, status } = req.query as {
    listId?: string; assigneeId?: string; status?: string;
  };

  if (listId && !(await canUserAccessList(req.user!.id, listId))) throw createError(403, 'Forbidden');

  const tasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      ...(listId && { listId }),
      ...(assigneeId && { assignments: { some: { assigneeId } } }),
      ...(status && { status: status as TaskStatus }),
    },
    include: {
      assignments: { include: { assignee: { select: { id: true, name: true, avatarUrl: true } } } },
      creator: { select: { id: true, name: true } },
      _count: { select: { subtasks: { where: { deletedAt: null } } } },
    },
    orderBy: { order: 'asc' },
  });
  res.json(tasks);
});

// POST /api/tasks
router.post('/', async (req: Request, res: Response) => {
  const body = z.object({
    listId: z.string().uuid(),
    parentId: z.string().uuid().optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    priority: z.nativeEnum(TaskPriority).optional().default(TaskPriority.MEDIUM),
    dueDate: z.string().datetime().optional(),
  }).parse(req.body);

  if (!(await canUserWriteList(req.user!.id, body.listId))) throw createError(403, 'Forbidden');

  const maxOrder = await prisma.task.aggregate({
    where: { listId: body.listId, parentId: body.parentId ?? null, deletedAt: null },
    _max: { order: true },
  });
  const order = (maxOrder._max.order ?? 0) + 1000;

  const task = await prisma.task.create({
    data: {
      ...body,
      order,
      creatorId: req.user!.id,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
    },
    include: {
      assignments: true,
      creator: { select: { id: true, name: true } },
    },
  });

  // Notify list viewers
  sse.broadcastAll('task.created', { task });
  res.status(201).json(task);
});

// GET /api/tasks/:id
router.get('/:id', async (req: Request, res: Response) => {
  if (!(await canUserAccessTask(req.user!.id, req.params.id))) throw createError(403, 'Forbidden');

  const task = await prisma.task.findUnique({
    where: { id: req.params.id, deletedAt: null },
    include: {
      subtasks: {
        where: { deletedAt: null },
        orderBy: { order: 'asc' },
        include: { assignments: { include: { assignee: { select: { id: true, name: true, avatarUrl: true } } } } },
      },
      assignments: {
        include: { assignee: { select: { id: true, name: true, avatarUrl: true } } },
      },
      creator: { select: { id: true, name: true } },
      list: { select: { id: true, title: true, scope: true } },
    },
  });
  if (!task) throw createError(404, 'Task not found');
  res.json(task);
});

// PATCH /api/tasks/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const existing = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!existing) throw createError(404, 'Task not found');
  if (!(await canUserWriteList(req.user!.id, existing.listId))) throw createError(403, 'Forbidden');

  const body = z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    status: z.nativeEnum(TaskStatus).optional(),
    priority: z.nativeEnum(TaskPriority).optional(),
    order: z.number().optional(),
    dueDate: z.string().datetime().nullable().optional(),
  }).parse(req.body);

  const task = await prisma.task.update({
    where: { id: req.params.id },
    data: {
      ...body,
      ...(body.dueDate !== undefined && { dueDate: body.dueDate ? new Date(body.dueDate) : null }),
    },
  });

  sse.broadcastAll('task.updated', { task });
  res.json(task);
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const existing = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!existing) throw createError(404, 'Task not found');

  const canDelete = req.user!.role === UserRole.ADMIN ||
    existing.creatorId === req.user!.id ||
    await canUserWriteList(req.user!.id, existing.listId);
  if (!canDelete) throw createError(403, 'Forbidden');

  await prisma.task.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  sse.broadcastAll('task.deleted', { taskId: req.params.id });
  res.status(204).end();
});

// POST /api/tasks/:id/move
router.post('/:id/move', async (req: Request, res: Response) => {
  const body = z.object({ targetListId: z.string().uuid() }).parse(req.body);

  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) throw createError(404, 'Task not found');
  if (!(await canUserWriteList(req.user!.id, task.listId))) throw createError(403, 'Forbidden');
  if (!(await canUserWriteList(req.user!.id, body.targetListId))) throw createError(403, 'Forbidden on target list');

  const maxOrder = await prisma.task.aggregate({
    where: { listId: body.targetListId, deletedAt: null },
    _max: { order: true },
  });
  const order = (maxOrder._max.order ?? 0) + 1000;

  const updated = await prisma.task.update({
    where: { id: req.params.id },
    data: { listId: body.targetListId, order },
  });
  sse.broadcastAll('task.moved', { task: updated });
  res.json(updated);
});

// POST /api/tasks/:id/assign
router.post('/:id/assign', async (req: Request, res: Response) => {
  const body = z.object({
    assigneeId: z.string().uuid(),
    note: z.string().optional(),
  }).parse(req.body);

  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) throw createError(404, 'Task not found');
  if (!(await canUserAccessTask(req.user!.id, req.params.id))) throw createError(403, 'Forbidden');

  const assignment = await prisma.taskAssignment.create({
    data: {
      taskId: req.params.id,
      assigneeId: body.assigneeId,
      assignedById: req.user!.id,
      note: body.note,
    },
    include: { assignee: { select: { id: true, name: true } } },
  });

  // Notify the assignee
  sse.emit(body.assigneeId, 'assignment.created', { assignment, task: { id: task.id, title: task.title } });
  res.status(201).json(assignment);
});

// PATCH /api/tasks/:id/assignments/:aid
router.patch('/:id/assignments/:aid', async (req: Request, res: Response) => {
  const body = z.object({
    status: z.enum(['ACCEPTED', 'REJECTED']),
    responseNote: z.string().optional(),
  }).parse(req.body);

  const assignment = await prisma.taskAssignment.findUnique({ where: { id: req.params.aid } });
  if (!assignment) throw createError(404, 'Assignment not found');
  if (assignment.assigneeId !== req.user!.id) throw createError(403, 'Only the assignee can respond');

  const updated = await prisma.taskAssignment.update({
    where: { id: req.params.aid },
    data: { status: body.status as any, responseNote: body.responseNote, respondedAt: new Date() },
    include: { assignee: { select: { id: true, name: true } } },
  });

  // Notify the assigner
  if (assignment.assignedById) {
    sse.emit(assignment.assignedById, 'assignment.updated', { assignment: updated });
  }
  res.json(updated);
});

// DELETE /api/tasks/:id/assignments/:aid — withdraw assignment
router.delete('/:id/assignments/:aid', async (req: Request, res: Response) => {
  const assignment = await prisma.taskAssignment.findUnique({ where: { id: req.params.aid } });
  if (!assignment) throw createError(404, 'Assignment not found');

  const canWithdraw = assignment.assignedById === req.user!.id || req.user!.role === UserRole.ADMIN;
  if (!canWithdraw) throw createError(403, 'Only the assigner can withdraw');

  await prisma.taskAssignment.delete({ where: { id: req.params.aid } });

  sse.emit(assignment.assigneeId, 'assignment.withdrawn', { assignmentId: req.params.aid });
  res.status(204).end();
});

export default router;
