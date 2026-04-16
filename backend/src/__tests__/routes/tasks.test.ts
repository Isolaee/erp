import 'express-async-errors';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { UserRole, TaskStatus, TaskPriority, ListScope } from '@prisma/client';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    task: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
    taskList: { findUnique: jest.fn() },
    taskAssignment: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    teamMember: { findUnique: jest.fn(), findMany: jest.fn() },
  },
}));

jest.mock('../../lib/redis', () => ({
  redis: null,
  redisSetex: jest.fn(),
  redisExists: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../services/sseService', () => ({
  emit: jest.fn(),
  broadcast: jest.fn(),
  broadcastAll: jest.fn(),
}));

import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { createApp } from '../helpers/createApp';
import tasksRouter from '../../routes/tasks';

const app = createApp('/api/tasks', tasksRouter);

const mockTask = prisma.task as any;
const mockTaskList = prisma.taskList as any;
const mockAssignment = prisma.taskAssignment as any;
const mockUser = prisma.user as any;
const mockTeamMember = prisma.teamMember as any;

// Valid UUIDs to pass Zod .uuid() validation
const LIST_UUID = 'a0b1c2d3-e4f5-6789-abcd-ef0123456789';
const TASK_UUID = 'b1c2d3e4-f5a6-7890-bcde-f01234567890';
const USER_UUID = 'c2d3e4f5-a6b7-8901-cdef-012345678901';

function bearerToken(id = 'user-1', role: UserRole = UserRole.MEMBER) {
  return `Bearer ${jwt.sign({ sub: id, email: `${id}@t.com`, role }, config.JWT_SECRET, { expiresIn: '15m' })}`;
}

function makeList(overrides = {}) {
  return {
    id: 'list-1',
    ownerId: 'user-1',
    scope: ListScope.PERSONAL,
    visibility: 'PRIVATE',
    teamId: null,
    deletedAt: null,
    ownerUser: { role: UserRole.MEMBER },
    ...overrides,
  };
}

function makeTask(overrides = {}) {
  return {
    id: 'task-1',
    listId: 'list-1',
    parentId: null,
    title: 'Fix bug',
    description: null,
    status: TaskStatus.OPEN,
    priority: TaskPriority.MEDIUM,
    order: 1000,
    creatorId: 'user-1',
    dueDate: null,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    assignments: [],
    creator: { id: 'user-1', name: 'Alice' },
    ...overrides,
  };
}

function makeUser(id = 'user-1', role: UserRole = UserRole.MEMBER) {
  return { id, email: `${id}@t.com`, role, deletedAt: null };
}

// Setup access control mocks so canUserWriteList/canUserAccessTask returns true for user-1
function allowAccess() {
  mockTaskList.findUnique.mockResolvedValue(makeList());
  mockUser.findUnique.mockResolvedValue(makeUser());
}

describe('GET /api/tasks', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns tasks for a given list when user has access', async () => {
    allowAccess();
    const task = makeTask();
    mockTask.findMany.mockResolvedValue([task]);

    const res = await request(app)
      .get('/api/tasks?listId=list-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe('task-1');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
  });

  it('returns 403 when user cannot access the list', async () => {
    mockTaskList.findUnique.mockResolvedValue(makeList({ ownerId: 'other', visibility: 'PRIVATE' }));
    mockUser.findUnique.mockResolvedValue(makeUser('user-1'));
    mockTeamMember.findUnique.mockResolvedValue(null);
    mockTeamMember.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/tasks?listId=list-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(403);
  });

  it('returns all tasks when no listId filter is given', async () => {
    mockTask.findMany.mockResolvedValue([makeTask()]);

    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/tasks', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a task and returns 201', async () => {
    allowAccess();
    mockTask.aggregate.mockResolvedValue({ _max: { order: 1000 } });
    const task = makeTask({ title: 'New task' });
    mockTask.create.mockResolvedValue(task);

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', bearerToken())
      .send({ listId: LIST_UUID, title: 'New task' });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('New task');
    expect(mockTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          order: 2000,
          creatorId: 'user-1',
        }),
      }),
    );
  });

  it('uses order 1000 when no existing tasks', async () => {
    allowAccess();
    mockTask.aggregate.mockResolvedValue({ _max: { order: null } });
    mockTask.create.mockResolvedValue(makeTask());

    await request(app)
      .post('/api/tasks')
      .set('Authorization', bearerToken())
      .send({ listId: LIST_UUID, title: 'First task' });

    expect(mockTask.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ order: 1000 }) }),
    );
  });

  it('returns 400 when title is missing', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', bearerToken())
      .send({ listId: LIST_UUID });

    expect(res.status).toBe(400);
  });

  it('returns 403 when user cannot write to the list', async () => {
    mockTaskList.findUnique.mockResolvedValue(makeList({ ownerId: 'other' }));
    mockUser.findUnique.mockResolvedValue(makeUser());
    mockTeamMember.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', bearerToken())
      .send({ listId: LIST_UUID, title: 'Task' });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/tasks/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a task for an authorized user', async () => {
    // canUserAccessTask → task.findUnique, then canUserAccessList → taskList.findUnique + user.findUnique
    mockTask.findUnique
      .mockResolvedValueOnce({ id: 'task-1', listId: 'list-1', deletedAt: null }) // for canUserAccessTask
      .mockResolvedValueOnce(makeTask({ subtasks: [], list: { id: 'list-1', title: 'My List', scope: 'PERSONAL' } })); // actual fetch
    mockTaskList.findUnique.mockResolvedValue(makeList());
    mockUser.findUnique.mockResolvedValue(makeUser());

    const res = await request(app)
      .get('/api/tasks/task-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('task-1');
  });

  it('returns 403 for a task the user cannot access', async () => {
    mockTask.findUnique.mockResolvedValue({ id: 'task-1', listId: 'list-1', deletedAt: null });
    mockTaskList.findUnique.mockResolvedValue(makeList({ ownerId: 'other', visibility: 'PRIVATE' }));
    mockUser.findUnique.mockResolvedValue(makeUser());
    mockTeamMember.findUnique.mockResolvedValue(null);
    mockTeamMember.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/tasks/task-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/tasks/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates a task and returns the updated task', async () => {
    mockTask.findUnique.mockResolvedValue(makeTask());
    allowAccess();
    const updated = makeTask({ title: 'Updated', status: TaskStatus.IN_PROGRESS });
    mockTask.update.mockResolvedValue(updated);

    const res = await request(app)
      .patch('/api/tasks/task-1')
      .set('Authorization', bearerToken())
      .send({ title: 'Updated', status: 'IN_PROGRESS' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated');
  });

  it('returns 404 when task does not exist', async () => {
    mockTask.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/tasks/nonexistent')
      .set('Authorization', bearerToken())
      .send({ title: 'New title' });

    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid status value', async () => {
    mockTask.findUnique.mockResolvedValue(makeTask());
    allowAccess();

    const res = await request(app)
      .patch('/api/tasks/task-1')
      .set('Authorization', bearerToken())
      .send({ status: 'INVALID_STATUS' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/tasks/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('soft-deletes a task created by the current user', async () => {
    mockTask.findUnique.mockResolvedValue(makeTask({ creatorId: 'user-1' }));
    mockTask.update.mockResolvedValue({ ...makeTask(), deletedAt: new Date() });

    const res = await request(app)
      .delete('/api/tasks/task-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(204);
    expect(mockTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
  });

  it('returns 404 when task does not exist', async () => {
    mockTask.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/tasks/missing')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(404);
  });

  it('ADMIN can delete any task', async () => {
    mockTask.findUnique.mockResolvedValue(makeTask({ creatorId: 'someone-else' }));
    mockTask.update.mockResolvedValue({ ...makeTask(), deletedAt: new Date() });

    const res = await request(app)
      .delete('/api/tasks/task-1')
      .set('Authorization', bearerToken('admin-1', UserRole.ADMIN));

    expect(res.status).toBe(204);
  });
});

describe('POST /api/tasks/:id/move', () => {
  beforeEach(() => jest.clearAllMocks());

  it('moves a task to a different list', async () => {
    // task lookup
    mockTask.findUnique.mockResolvedValue(makeTask());
    // canUserWriteList for source list, then target list
    mockTaskList.findUnique
      .mockResolvedValueOnce(makeList())
      .mockResolvedValueOnce(makeList({ id: 'list-2' }));
    mockUser.findUnique.mockResolvedValue(makeUser());
    mockTask.aggregate.mockResolvedValue({ _max: { order: 2000 } });
    const movedTask = makeTask({ listId: 'list-2', order: 3000 });
    mockTask.update.mockResolvedValue(movedTask);

    const res = await request(app)
      .post('/api/tasks/task-1/move')
      .set('Authorization', bearerToken())
      .send({ targetListId: 'a0b1c2d3-e4f5-6789-abcd-ef0123456789' });

    expect(res.status).toBe(200);
  });

  it('returns 400 when targetListId is not a valid UUID', async () => {
    const res = await request(app)
      .post('/api/tasks/task-1/move')
      .set('Authorization', bearerToken())
      .send({ targetListId: 'not-a-uuid' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/tasks/:id/assign', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates an assignment and notifies the assignee', async () => {
    mockTask.findUnique.mockResolvedValue({ id: 'task-1', listId: 'list-1', deletedAt: null });
    mockTaskList.findUnique.mockResolvedValue(makeList());
    mockUser.findUnique.mockResolvedValue(makeUser());
    const assignment = {
      id: 'assign-1',
      taskId: 'task-1',
      assigneeId: 'user-2',
      assignedById: 'user-1',
      status: 'PENDING_ACCEPTANCE',
      assignee: { id: 'user-2', name: 'Bob' },
    };
    mockAssignment.create.mockResolvedValue(assignment);

    const res = await request(app)
      .post('/api/tasks/task-1/assign')
      .set('Authorization', bearerToken())
      .send({ assigneeId: 'a0b1c2d3-e4f5-6789-abcd-ef0123456789' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('assign-1');
  });

  it('returns 400 when assigneeId is not a valid UUID', async () => {
    const res = await request(app)
      .post('/api/tasks/task-1/assign')
      .set('Authorization', bearerToken())
      .send({ assigneeId: 'not-a-uuid' });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/tasks/:id/assignments/:aid', () => {
  beforeEach(() => jest.clearAllMocks());

  it('allows the assignee to accept an assignment', async () => {
    mockAssignment.findUnique.mockResolvedValue({
      id: 'assign-1',
      assigneeId: 'user-1',
      assignedById: 'user-2',
      taskId: 'task-1',
    });
    const updated = {
      id: 'assign-1',
      status: 'ACCEPTED',
      assignee: { id: 'user-1', name: 'Alice' },
    };
    mockAssignment.update.mockResolvedValue(updated);

    const res = await request(app)
      .patch('/api/tasks/task-1/assignments/assign-1')
      .set('Authorization', bearerToken('user-1'))
      .send({ status: 'ACCEPTED' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACCEPTED');
  });

  it('returns 403 when a non-assignee tries to respond', async () => {
    mockAssignment.findUnique.mockResolvedValue({
      id: 'assign-1',
      assigneeId: 'user-2', // different from the requester
      assignedById: 'user-3',
    });

    const res = await request(app)
      .patch('/api/tasks/task-1/assignments/assign-1')
      .set('Authorization', bearerToken('user-1'))
      .send({ status: 'ACCEPTED' });

    expect(res.status).toBe(403);
  });

  it('returns 404 when assignment does not exist', async () => {
    mockAssignment.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/tasks/task-1/assignments/missing')
      .set('Authorization', bearerToken())
      .send({ status: 'ACCEPTED' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tasks/:id/assignments/:aid', () => {
  beforeEach(() => jest.clearAllMocks());

  it('allows the assigner to withdraw an assignment', async () => {
    mockAssignment.findUnique.mockResolvedValue({
      id: 'assign-1',
      assigneeId: 'user-2',
      assignedById: 'user-1',
    });
    mockAssignment.delete.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/tasks/task-1/assignments/assign-1')
      .set('Authorization', bearerToken('user-1'));

    expect(res.status).toBe(204);
    expect(mockAssignment.delete).toHaveBeenCalled();
  });

  it('returns 403 when user is neither assigner nor ADMIN', async () => {
    mockAssignment.findUnique.mockResolvedValue({
      id: 'assign-1',
      assigneeId: 'user-3',
      assignedById: 'user-2', // different from user-1
    });

    const res = await request(app)
      .delete('/api/tasks/task-1/assignments/assign-1')
      .set('Authorization', bearerToken('user-1'));

    expect(res.status).toBe(403);
  });

  it('returns 404 when assignment does not exist', async () => {
    mockAssignment.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/tasks/task-1/assignments/missing')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(404);
  });
});
