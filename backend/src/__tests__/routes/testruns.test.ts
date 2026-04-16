import 'express-async-errors';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    testRun: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    repoFollow: { findUnique: jest.fn(), findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

jest.mock('../../lib/redis', () => ({
  redis: null,
  redisSetex: jest.fn(),
  redisExists: jest.fn().mockResolvedValue(false),
}));

// Mock the analysis service — we don't want it running in tests
jest.mock('../../services/testAnalysisService', () => ({
  analyzeTestRun: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { createApp } from '../helpers/createApp';
import testrunsRouter from '../../routes/testruns';

const app = createApp('/api/testruns', testrunsRouter);
const mockTestRun = prisma.testRun as any;
const mockRepoFollow = prisma.repoFollow as any;

function bearerToken(id = 'user-1', role: UserRole = UserRole.MEMBER) {
  return `Bearer ${jwt.sign({ sub: id, email: `${id}@t.com`, role }, config.JWT_SECRET, { expiresIn: '15m' })}`;
}

function makeRun(overrides = {}) {
  return {
    id: 'run-1',
    repoFollowId: 'follow-1',
    status: 'PENDING',
    trigger: 'MANUAL',
    branch: 'main',
    commitSha: 'abc123',
    commitMessage: 'Test commit',
    ghRunId: null,
    ghRunUrl: null,
    aiNeedsUpdate: null,
    aiAnalysis: null,
    prNumber: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date().toISOString(),
    _count: { testResults: 0 },
    ...overrides,
  };
}

// Helper: makes assertTeamAccess pass (user is a member of the team)
function allowTeamAccess() {
  mockRepoFollow.findUnique.mockResolvedValue({
    id: 'follow-1',
    team: { members: [{ userId: 'user-1' }] },
  });
}

describe('GET /api/testruns', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns runs for a followed repo the user belongs to', async () => {
    allowTeamAccess();
    mockTestRun.findMany.mockResolvedValue([makeRun()]);
    mockTestRun.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/testruns?repoFollowId=follow-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.runs[0].id).toBe('run-1');
  });

  it('returns 400 when repoFollowId is missing', async () => {
    const res = await request(app)
      .get('/api/testruns')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(400);
  });

  it('returns 403 when user is not a team member', async () => {
    mockRepoFollow.findUnique.mockResolvedValue({
      id: 'follow-1',
      team: { members: [] }, // empty — user is not a member
    });

    const res = await request(app)
      .get('/api/testruns?repoFollowId=follow-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(403);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/testruns?repoFollowId=follow-1');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/testruns/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a test run with results', async () => {
    const run = { ...makeRun(), testResults: [], repoFollow: { id: 'follow-1', owner: 'acme', repo: 'widget', teamId: 'team-1' } };
    mockTestRun.findUnique.mockResolvedValue(run);
    allowTeamAccess();

    const res = await request(app)
      .get('/api/testruns/run-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('run-1');
    expect(res.body.ghRunId).toBeNull();
  });

  it('returns 404 when run does not exist', async () => {
    mockTestRun.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/testruns/missing')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(404);
  });
});

describe('POST /api/testruns', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a PENDING test run and returns 202', async () => {
    // assertTeamAccess call needs team+members, second findUnique (follow lookup) needs just id
    mockRepoFollow.findUnique
      .mockResolvedValueOnce({ id: 'follow-1', team: { members: [{ userId: 'user-1' }] } })
      .mockResolvedValueOnce({ id: 'follow-1' });
    const run = makeRun();
    mockTestRun.create.mockResolvedValue(run);

    const res = await request(app)
      .post('/api/testruns')
      .set('Authorization', bearerToken())
      .send({ repoFollowId: 'follow-1', commitSha: 'abc123', branch: 'main' });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('PENDING');
    expect(mockTestRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ trigger: 'MANUAL', status: 'PENDING' }),
      }),
    );
  });

  it('returns 400 when repoFollowId is missing', async () => {
    const res = await request(app)
      .post('/api/testruns')
      .set('Authorization', bearerToken())
      .send({ commitSha: 'abc123' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when commitSha is missing', async () => {
    const res = await request(app)
      .post('/api/testruns')
      .set('Authorization', bearerToken())
      .send({ repoFollowId: 'follow-1' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when both repoFollowId and commitSha are missing', async () => {
    const res = await request(app)
      .post('/api/testruns')
      .set('Authorization', bearerToken())
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/testruns/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cancels a PENDING run', async () => {
    mockTestRun.findUnique.mockResolvedValue(makeRun({ status: 'PENDING' }));
    allowTeamAccess();
    const cancelled = makeRun({ status: 'CANCELLED' });
    mockTestRun.update.mockResolvedValue(cancelled);

    const res = await request(app)
      .delete('/api/testruns/run-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
  });

  it('cancels a RUNNING run', async () => {
    mockTestRun.findUnique.mockResolvedValue(makeRun({ status: 'RUNNING' }));
    allowTeamAccess();
    mockTestRun.update.mockResolvedValue(makeRun({ status: 'CANCELLED' }));

    const res = await request(app)
      .delete('/api/testruns/run-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
  });

  it('returns 409 when run is already completed', async () => {
    mockTestRun.findUnique.mockResolvedValue(makeRun({ status: 'PASSED' }));
    allowTeamAccess();

    const res = await request(app)
      .delete('/api/testruns/run-1')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(409);
  });

  it('returns 404 when run does not exist', async () => {
    mockTestRun.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/testruns/missing')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(404);
  });
});
