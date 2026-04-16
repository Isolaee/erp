import 'express-async-errors';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    taskAssignment: { findMany: jest.fn() },
    teamMember: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

jest.mock('../../lib/redis', () => ({
  redis: null,
  redisSetex: jest.fn(),
  redisExists: jest.fn().mockResolvedValue(false),
}));

import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { createApp } from '../helpers/createApp';
import dashboardRouter from '../../routes/dashboard';

const app = createApp('/api/dashboard', dashboardRouter);
const mockAssignment = prisma.taskAssignment as any;
const mockTeamMember = prisma.teamMember as any;

function bearerToken(id = 'user-1', role: UserRole = UserRole.MEMBER) {
  return `Bearer ${jwt.sign({ sub: id, email: `${id}@t.com`, role }, config.JWT_SECRET, { expiresIn: '15m' })}`;
}

function makeAssignment(overrides = {}) {
  return {
    id: 'assign-1',
    status: 'PENDING_ACCEPTANCE',
    note: null,
    responseNote: null,
    createdAt: new Date().toISOString(),
    assignedById: 'user-2',
    assignee: { id: 'user-1', name: 'Alice', avatarUrl: null },
    task: {
      id: 'task-1',
      title: 'Fix bug',
      description: null,
      status: 'OPEN',
      priority: 'MEDIUM',
      dueDate: null,
      creatorId: 'user-2',
      creator: { id: 'user-2', name: 'Bob' },
      list: {
        id: 'list-1',
        title: 'My List',
        scope: 'ORGANIZATION',
        team: null,
        ownerUser: { id: 'user-2', name: 'Bob' },
      },
    },
    ...overrides,
  };
}

describe('GET /api/dashboard/personal', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the 3 most recent assignments for the caller', async () => {
    mockAssignment.findMany.mockResolvedValue([makeAssignment()]);

    const res = await request(app)
      .get('/api/dashboard/personal')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].assignment.id).toBe('assign-1');
    expect(res.body[0].task.title).toBe('Fix bug');
    expect(mockAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assigneeId: 'user-1', task: { deletedAt: null } },
        take: 3,
      }),
    );
  });

  it('returns an empty array when there are no assignments', async () => {
    mockAssignment.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/dashboard/personal')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/dashboard/personal');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/dashboard/org', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns org-wide assignment cards', async () => {
    mockAssignment.findMany.mockResolvedValue([makeAssignment()]);

    const res = await request(app)
      .get('/api/dashboard/org')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body[0].list.scope).toBe('ORGANIZATION');
  });

  it('serialises team field as null when no team', async () => {
    mockAssignment.findMany.mockResolvedValue([
      makeAssignment({ task: { ...makeAssignment().task, list: { ...makeAssignment().task.list, team: null } } }),
    ]);

    const res = await request(app)
      .get('/api/dashboard/org')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body[0].team).toBeNull();
  });
});

describe('GET /api/dashboard/team/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns team assignment cards for a team member', async () => {
    mockTeamMember.findUnique.mockResolvedValue({ userId: 'user-1', teamId: 'team-1', role: UserRole.MEMBER });
    mockAssignment.findMany.mockResolvedValue([makeAssignment()]);

    const res = await request(app)
      .get('/api/dashboard/team/team-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns team cards for ADMIN even without membership', async () => {
    mockTeamMember.findUnique.mockResolvedValue(null);
    mockAssignment.findMany.mockResolvedValue([makeAssignment()]);

    const res = await request(app)
      .get('/api/dashboard/team/team-1')
      .set('Authorization', bearerToken('admin-1', UserRole.ADMIN));

    expect(res.status).toBe(200);
  });

  it('returns 403 for a non-member non-admin user', async () => {
    mockTeamMember.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/dashboard/team/team-1')
      .set('Authorization', bearerToken('user-1', UserRole.MEMBER));

    expect(res.status).toBe(403);
  });
});
