import 'express-async-errors';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
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
import usersRouter from '../../routes/users';

const app = createApp('/api/users', usersRouter);
const mockUser = prisma.user as any;

function bearerToken(id = 'user-1', role: UserRole = UserRole.MEMBER) {
  return `Bearer ${jwt.sign({ sub: id, email: `${id}@t.com`, role }, config.JWT_SECRET, { expiresIn: '15m' })}`;
}

function makeUser(overrides = {}) {
  return {
    id: 'user-1',
    email: 'alice@test.com',
    name: 'Alice',
    role: UserRole.MEMBER,
    avatarUrl: null,
    createdAt: new Date().toISOString(),
    teamMemberships: [],
    ...overrides,
  };
}

describe('GET /api/users', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns all users for a TEAM_LEAD', async () => {
    mockUser.findMany.mockResolvedValue([makeUser()]);

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', bearerToken('lead-1', UserRole.TEAM_LEAD));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].email).toBe('alice@test.com');
  });

  it('returns all users for an ADMIN', async () => {
    mockUser.findMany.mockResolvedValue([makeUser()]);

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', bearerToken('admin-1', UserRole.ADMIN));

    expect(res.status).toBe(200);
  });

  it('returns 403 for a MEMBER', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', bearerToken('member-1', UserRole.MEMBER));

    expect(res.status).toBe(403);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/users/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a user profile with team memberships', async () => {
    mockUser.findUnique.mockResolvedValue(makeUser({
      teamMemberships: [{ team: { id: 'team-1', name: 'Engineering' } }],
    }));

    const res = await request(app)
      .get('/api/users/user-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('user-1');
    expect(res.body.teamMemberships).toHaveLength(1);
  });

  it('returns 404 when user does not exist', async () => {
    mockUser.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/users/nonexistent')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/users/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('allows a user to update their own profile', async () => {
    mockUser.update.mockResolvedValue(makeUser({ name: 'Alice Updated' }));

    const res = await request(app)
      .patch('/api/users/user-1')
      .set('Authorization', bearerToken('user-1'))
      .send({ name: 'Alice Updated' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Alice Updated');
    expect(mockUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Alice Updated' } }),
    );
  });

  it('allows ADMIN to update any user', async () => {
    mockUser.update.mockResolvedValue(makeUser({ id: 'user-2', name: 'Bob' }));

    const res = await request(app)
      .patch('/api/users/user-2')
      .set('Authorization', bearerToken('admin-1', UserRole.ADMIN))
      .send({ name: 'Bob' });

    expect(res.status).toBe(200);
  });

  it('returns 403 when non-admin tries to update another user', async () => {
    const res = await request(app)
      .patch('/api/users/user-2')
      .set('Authorization', bearerToken('user-1', UserRole.MEMBER))
      .send({ name: 'Hacker' });

    expect(res.status).toBe(403);
  });

  it('returns 400 for an invalid avatarUrl', async () => {
    const res = await request(app)
      .patch('/api/users/user-1')
      .set('Authorization', bearerToken('user-1'))
      .send({ avatarUrl: 'not-a-url' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/users/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('soft-deletes a user (ADMIN only)', async () => {
    mockUser.update.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/users/user-2')
      .set('Authorization', bearerToken('admin-1', UserRole.ADMIN));

    expect(res.status).toBe(204);
    expect(mockUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
  });

  it('returns 400 when admin tries to delete themselves', async () => {
    const res = await request(app)
      .delete('/api/users/admin-1')
      .set('Authorization', bearerToken('admin-1', UserRole.ADMIN));

    expect(res.status).toBe(400);
  });

  it('returns 403 for non-ADMIN users', async () => {
    const res = await request(app)
      .delete('/api/users/user-2')
      .set('Authorization', bearerToken('user-1', UserRole.MEMBER));

    expect(res.status).toBe(403);
  });
});
