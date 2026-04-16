import 'express-async-errors';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    repoFollow: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

jest.mock('../../lib/redis', () => ({
  redis: null,
  redisSetex: jest.fn(),
  redisExists: jest.fn().mockResolvedValue(false),
  redisGet: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/githubService', () => ({
  getRepo: jest.fn(),
  getIssues: jest.fn(),
  getPulls: jest.fn(),
  getCommits: jest.fn(),
}));

import { prisma } from '../../lib/prisma';
import * as githubService from '../../services/githubService';
import { config } from '../../config';
import { createApp } from '../helpers/createApp';
import githubRouter from '../../routes/github';

const app = createApp('/api/github', githubRouter);
const mockRepoFollow = prisma.repoFollow as any;
const mockUser = prisma.user as any;
const mockGithub = githubService as any;

function bearerToken(id = 'user-1', role: UserRole = UserRole.MEMBER) {
  return `Bearer ${jwt.sign({ sub: id, email: `${id}@t.com`, role }, config.JWT_SECRET, { expiresIn: '15m' })}`;
}

// Both token resolution paths return null → githubService uses env fallback
function noToken() {
  mockRepoFollow.findFirst.mockResolvedValue(null);
  mockUser.findUnique.mockResolvedValue({ githubToken: null });
}

describe('GET /api/github/repos/:owner/:repo', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns repo metadata', async () => {
    noToken();
    mockGithub.getRepo.mockResolvedValue({
      id: 123,
      fullName: 'acme/widget',
      description: 'Widget repo',
      stars: 42,
      forks: 7,
      openIssues: 3,
      url: 'https://github.com/acme/widget',
      defaultBranch: 'main',
      private: false,
    });

    const res = await request(app)
      .get('/api/github/repos/acme/widget')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('acme/widget');
    expect(mockGithub.getRepo).toHaveBeenCalledWith('acme', 'widget', null);
  });

  it('returns 404 when githubService throws', async () => {
    noToken();
    mockGithub.getRepo.mockRejectedValue(new Error('not found'));

    const res = await request(app)
      .get('/api/github/repos/acme/missing')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Repository not found or access denied');
  });

  it('uses the team PAT when a RepoFollow exists with a team PAT', async () => {
    mockRepoFollow.findFirst.mockResolvedValue({ team: { githubPat: 'team-pat-token' } });
    mockGithub.getRepo.mockResolvedValue({ fullName: 'acme/widget' });

    const res = await request(app)
      .get('/api/github/repos/acme/widget')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(mockGithub.getRepo).toHaveBeenCalledWith('acme', 'widget', 'team-pat-token');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/github/repos/acme/widget');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/github/repos/:owner/:repo/issues', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns open issues', async () => {
    noToken();
    mockGithub.getIssues.mockResolvedValue([{ id: 1, title: 'Bug report' }]);

    const res = await request(app)
      .get('/api/github/repos/acme/widget/issues')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body[0].title).toBe('Bug report');
    expect(mockGithub.getIssues).toHaveBeenCalledWith('acme', 'widget', 1, null);
  });

  it('passes page query parameter to githubService', async () => {
    noToken();
    mockGithub.getIssues.mockResolvedValue([]);

    await request(app)
      .get('/api/github/repos/acme/widget/issues?page=3')
      .set('Authorization', bearerToken());

    expect(mockGithub.getIssues).toHaveBeenCalledWith('acme', 'widget', 3, null);
  });
});

describe('GET /api/github/repos/:owner/:repo/pulls', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns open pull requests', async () => {
    noToken();
    mockGithub.getPulls.mockResolvedValue([{ id: 1, title: 'Add feature' }]);

    const res = await request(app)
      .get('/api/github/repos/acme/widget/pulls')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body[0].title).toBe('Add feature');
  });
});

describe('GET /api/github/repos/:owner/:repo/commits', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns commits', async () => {
    noToken();
    mockGithub.getCommits.mockResolvedValue([{ sha: 'abc123', message: 'Initial commit' }]);

    const res = await request(app)
      .get('/api/github/repos/acme/widget/commits')
      .set('Authorization', bearerToken());

    expect(res.status).toBe(200);
    expect(res.body[0].sha).toBe('abc123');
  });
});
