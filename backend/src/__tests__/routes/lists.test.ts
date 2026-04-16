import 'express-async-errors';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { UserRole, ListScope, ListVisibility } from '@prisma/client';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    taskList: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    teamMember: { findUnique: jest.fn(), findMany: jest.fn() },
    task: { findUnique: jest.fn() },
  },
}));

jest.mock('../../lib/redis', () => ({
  redis: null,
  redisSetex: jest.fn(),
  redisExists: jest.fn().mockResolvedValue(false),
}));

// Mock SSE to prevent side effects
jest.mock('../../services/sseService', () => ({
  emit: jest.fn(),
  broadcast: jest.fn(),
  broadcastAll: jest.fn(),
}));

import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { createApp } from '../helpers/createApp';
import listsRouter from '../../routes/lists';

const app = createApp('/api/lists', listsRouter);

const mockTaskList = prisma.taskList as any;
const mockUser = prisma.user as any;
const mockTeamMember = prisma.teamMember as any;

function bearerToken(id = 'user-1', role: UserRole = UserRole.MEMBER) {
  return `Bearer ${jwt.sign({ sub: id, email: `${id}@t.com`, role }, config.JWT_SECRET, { expiresIn: '15m' })}`;
}

function makeList(overrides = {}) {
  return {
    id: 'list-1',
    title: 'My List',
    description: null,
    scope: ListScope.PERSONAL,
    visibility: ListVisibility.PRIVATE,
    ownerId: 'user-1',
    teamId: null,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ownerUser: { id: 'user-1', name: 'Alice' },
    team: null,
    _count: { tasks: 0 },
    ...overrides,
  };
}

function makeUser(id = 'user-1', role: UserRole = UserRole.MEMBER) {
  return { id, email: `${id}@t.com`, role, deletedAt: null };
}

describe('GET /api/lists', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns lists visible to the current user', async () => {
    const list = makeList();
    mockTaskList.findMany.mockResolvedValue([list]);
    // canUserAccessList: user is owner
    mockTaskList.findUnique.mockResolvedValue({ ...list, ownerUser: { role: UserRole.MEMBER } });
    mockUser.findUnique.mockResolvedValue(makeUser());

    const res = await request(app)
      .get('/api/lists')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe('list-1');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/lists');
    expect(res.status).toBe(401);
  });

  it('filters out lists the user cannot access', async () => {
    const list = makeList({ ownerId: 'other-user', visibility: ListVisibility.PRIVATE });
    mockTaskList.findMany.mockResolvedValue([list]);
    mockTaskList.findUnique.mockResolvedValue({ ...list, ownerUser: { role: UserRole.MEMBER } });
    mockUser.findUnique.mockResolvedValue(makeUser('user-1'));
    mockTeamMember.findUnique.mockResolvedValue(null);
    mockTeamMember.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/lists')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe('POST /api/lists', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a PERSONAL list and returns 201', async () => {
    const list = makeList({ title: 'New List', scope: ListScope.PERSONAL });
    mockTaskList.create.mockResolvedValue(list);

    const res = await request(app)
      .post('/api/lists')
      .set('Authorization', bearerToken())
      .send({ title: 'New List', scope: 'PERSONAL' });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('New List');
    expect(mockTaskList.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: 'user-1', scope: 'PERSONAL' }),
      }),
    );
  });

  it('returns 400 when creating a TEAM list without teamId', async () => {
    const res = await request(app)
      .post('/api/lists')
      .set('Authorization', bearerToken())
      .send({ title: 'Team List', scope: 'TEAM' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when title is missing', async () => {
    const res = await request(app)
      .post('/api/lists')
      .set('Authorization', bearerToken())
      .send({ scope: 'PERSONAL' });

    expect(res.status).toBe(400);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .post('/api/lists')
      .send({ title: 'List', scope: 'PERSONAL' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/lists/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the list with tasks for an authorized user', async () => {
    const list = makeList({ tasks: [] });
    // First call: canUserAccessList → taskList.findUnique
    mockTaskList.findUnique
      .mockResolvedValueOnce({ ...list, ownerUser: { role: UserRole.MEMBER } })
      // Second call: actual list fetch
      .mockResolvedValueOnce({ ...list, tasks: [] });
    mockUser.findUnique.mockResolvedValue(makeUser());

    const res = await request(app)
      .get('/api/lists/list-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('list-1');
  });

  it('returns 403 for a list the user cannot access', async () => {
    mockTaskList.findUnique.mockResolvedValue({
      ...makeList({ ownerId: 'other', visibility: ListVisibility.PRIVATE }),
      ownerUser: { role: UserRole.MEMBER },
    });
    mockUser.findUnique.mockResolvedValue(makeUser('user-1'));
    mockTeamMember.findUnique.mockResolvedValue(null);
    mockTeamMember.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/lists/list-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/lists/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates the list title for the owner', async () => {
    const list = makeList();
    // canUserWriteList → taskList.findUnique, user.findUnique
    mockTaskList.findUnique.mockResolvedValue(list);
    mockUser.findUnique.mockResolvedValue(makeUser());
    mockTaskList.update.mockResolvedValue({ ...list, title: 'Updated Title' });

    const res = await request(app)
      .patch('/api/lists/list-1')
      .set('Authorization', bearerToken())
      .send({ title: 'Updated Title' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');
  });

  it('returns 403 when user is not the owner', async () => {
    mockTaskList.findUnique.mockResolvedValue(makeList({ ownerId: 'other' }));
    mockUser.findUnique.mockResolvedValue(makeUser());
    mockTeamMember.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/lists/list-1')
      .set('Authorization', bearerToken())
      .send({ title: 'New Title' });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/lists/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('soft-deletes the list for the owner', async () => {
    const list = makeList();
    mockTaskList.findUnique.mockResolvedValue(list);
    mockTaskList.update.mockResolvedValue({ ...list, deletedAt: new Date() });

    const res = await request(app)
      .delete('/api/lists/list-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(204);
    expect(mockTaskList.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
  });

  it('returns 403 when user is not owner or ADMIN', async () => {
    mockTaskList.findUnique.mockResolvedValue(makeList({ ownerId: 'other' }));

    const res = await request(app)
      .delete('/api/lists/list-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(403);
  });

  it('returns 404 when list does not exist', async () => {
    mockTaskList.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/lists/list-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(404);
  });

  it('ADMIN can delete any list', async () => {
    const list = makeList({ ownerId: 'someone-else' });
    mockTaskList.findUnique.mockResolvedValue(list);
    mockTaskList.update.mockResolvedValue({ ...list, deletedAt: new Date() });

    const res = await request(app)
      .delete('/api/lists/list-1')
      .set('Authorization', bearerToken('admin-1', UserRole.ADMIN));

    expect(res.status).toBe(204);
  });
});
