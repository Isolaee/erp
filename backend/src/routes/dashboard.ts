import { Router, Request, Response } from 'express';
import { ListScope, ListVisibility, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

const router = Router();
router.use(verifyAccessToken);

// Shared include shape — gives every card the same rich data
const assignmentInclude = {
  task: {
    include: {
      list: {
        include: {
          team: { include: { repoFollows: true } },
          ownerUser: { select: { id: true, name: true } },
        },
      },
      creator: { select: { id: true, name: true } },
    },
  },
  assignee: { select: { id: true, name: true, avatarUrl: true } },
} as const;

// Serialise an assignment row into the dashboard card shape
function toCard(a: any) {
  return {
    assignment: {
      id: a.id,
      status: a.status,
      note: a.note,
      responseNote: a.responseNote,
      createdAt: a.createdAt,
      assignedById: a.assignedById,
      assignee: a.assignee,
    },
    task: {
      id: a.task.id,
      title: a.task.title,
      description: a.task.description,
      status: a.task.status,
      priority: a.task.priority,
      dueDate: a.task.dueDate,
      creatorId: a.task.creatorId,
      creator: a.task.creator,
    },
    list: {
      id: a.task.list.id,
      title: a.task.list.title,
      scope: a.task.list.scope,
    },
    team: a.task.list.team
      ? { id: a.task.list.team.id, name: a.task.list.team.name }
      : null,
    repos: (a.task.list.team?.repoFollows ?? []).map((r: any) => ({
      id: r.id,
      owner: r.owner,
      repo: r.repo,
    })),
  };
}

// GET /api/dashboard/personal — 3 most recently assigned tasks for the caller
router.get('/personal', async (req: Request, res: Response) => {
  const assignments = await prisma.taskAssignment.findMany({
    where: { assigneeId: req.user!.id, task: { deletedAt: null } },
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: assignmentInclude,
  });
  res.json(assignments.map(toCard));
});

// GET /api/dashboard/org — 3 most recently assigned tasks in ORGANIZATION-visible lists
router.get('/org', async (req: Request, res: Response) => {
  const assignments = await prisma.taskAssignment.findMany({
    where: {
      task: {
        deletedAt: null,
        list: { scope: ListScope.ORGANIZATION, visibility: ListVisibility.ORGANIZATION, deletedAt: null },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: assignmentInclude,
  });
  res.json(assignments.map(toCard));
});

// GET /api/dashboard/team/:id — 3 most recently assigned tasks in a specific team's lists
router.get('/team/:id', async (req: Request, res: Response) => {
  const teamId = req.params.id;

  // Only team members (or admins) can see this
  const membership = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId: req.user!.id, teamId } },
  });
  if (!membership && req.user!.role !== UserRole.ADMIN) throw createError(403, 'Forbidden');

  const assignments = await prisma.taskAssignment.findMany({
    where: {
      task: {
        deletedAt: null,
        list: { teamId, deletedAt: null },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: assignmentInclude,
  });
  res.json(assignments.map(toCard));
});

export default router;
