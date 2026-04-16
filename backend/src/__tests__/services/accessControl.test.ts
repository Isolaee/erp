import { UserRole, ListScope, ListVisibility, DocVisibility } from '@prisma/client';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: jest.fn() },
    task: { findUnique: jest.fn() },
    doc: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    teamMember: { findUnique: jest.fn(), findMany: jest.fn() },
  },
}));

import { prisma } from '../../lib/prisma';
import {
  canUserAccessList,
  canUserWriteList,
  canUserAccessTask,
  canUserAccessDoc,
  canUserWriteDoc,
} from '../../services/accessControl';

const mockList = prisma.taskList as any;
const mockUser = prisma.user as any;
const mockTeamMember = prisma.teamMember as any;
const mockTask = prisma.task as any;
const mockDoc = prisma.doc as any;

function makeUser(id: string, role: UserRole) {
  return { id, email: `${id}@t.com`, role, deletedAt: null };
}

function makeList(overrides: Partial<{
  id: string; ownerId: string; scope: ListScope; visibility: ListVisibility; teamId: string | null;
}> = {}) {
  return {
    id: 'list-1',
    ownerId: 'owner-1',
    scope: ListScope.PERSONAL,
    visibility: ListVisibility.PRIVATE,
    teamId: null,
    deletedAt: null,
    ownerUser: { role: UserRole.MEMBER },
    ...overrides,
  };
}

describe('canUserAccessList', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns true for the list owner', async () => {
    mockList.findUnique.mockResolvedValue(makeList({ ownerId: 'user-1' }));
    mockUser.findUnique.mockResolvedValue(makeUser('user-1', UserRole.MEMBER));

    expect(await canUserAccessList('user-1', 'list-1')).toBe(true);
  });

  it('returns true for ADMIN regardless of scope/visibility', async () => {
    mockList.findUnique.mockResolvedValue(makeList({ ownerId: 'other', visibility: ListVisibility.PRIVATE }));
    mockUser.findUnique.mockResolvedValue(makeUser('admin', UserRole.ADMIN));

    expect(await canUserAccessList('admin', 'list-1')).toBe(true);
  });

  it('returns true for ORGANIZATION scope + ORGANIZATION visibility', async () => {
    mockList.findUnique.mockResolvedValue(makeList({
      ownerId: 'other',
      scope: ListScope.ORGANIZATION,
      visibility: ListVisibility.ORGANIZATION,
    }));
    mockUser.findUnique.mockResolvedValue(makeUser('user-1', UserRole.MEMBER));

    expect(await canUserAccessList('user-1', 'list-1')).toBe(true);
  });

  it('returns false for ORGANIZATION scope + PRIVATE visibility (non-owner)', async () => {
    mockList.findUnique.mockResolvedValue(makeList({
      ownerId: 'other',
      scope: ListScope.ORGANIZATION,
      visibility: ListVisibility.PRIVATE,
    }));
    mockUser.findUnique.mockResolvedValue(makeUser('user-1', UserRole.MEMBER));

    expect(await canUserAccessList('user-1', 'list-1')).toBe(false);
  });

  it('returns true for TEAM scope + TEAM visibility for a team member', async () => {
    mockList.findUnique.mockResolvedValue(makeList({
      ownerId: 'other',
      scope: ListScope.TEAM,
      visibility: ListVisibility.TEAM,
      teamId: 'team-1',
    }));
    mockUser.findUnique.mockResolvedValue(makeUser('user-1', UserRole.MEMBER));
    mockTeamMember.findUnique.mockResolvedValue({ userId: 'user-1', teamId: 'team-1', role: UserRole.MEMBER });

    expect(await canUserAccessList('user-1', 'list-1')).toBe(true);
  });

  it('returns false for TEAM scope when user is not in the team', async () => {
    mockList.findUnique.mockResolvedValue(makeList({
      ownerId: 'other',
      scope: ListScope.TEAM,
      visibility: ListVisibility.TEAM,
      teamId: 'team-1',
    }));
    mockUser.findUnique.mockResolvedValue(makeUser('user-1', UserRole.MEMBER));
    mockTeamMember.findUnique.mockResolvedValue(null);

    expect(await canUserAccessList('user-1', 'list-1')).toBe(false);
  });

  it('returns false when list does not exist', async () => {
    mockList.findUnique.mockResolvedValue(null);

    expect(await canUserAccessList('user-1', 'missing')).toBe(false);
  });

  it('returns false when user does not exist', async () => {
    mockList.findUnique.mockResolvedValue(makeList());
    mockUser.findUnique.mockResolvedValue(null);

    expect(await canUserAccessList('ghost', 'list-1')).toBe(false);
  });

  it('returns true for PERSONAL + ORGANIZATION visibility for any user', async () => {
    mockList.findUnique.mockResolvedValue(makeList({
      ownerId: 'other',
      scope: ListScope.PERSONAL,
      visibility: ListVisibility.ORGANIZATION,
    }));
    mockUser.findUnique.mockResolvedValue(makeUser('user-1', UserRole.MEMBER));

    expect(await canUserAccessList('user-1', 'list-1')).toBe(true);
  });
});

describe('canUserWriteList', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns true for the list owner', async () => {
    mockList.findUnique.mockResolvedValue(makeList({ ownerId: 'user-1' }));
    mockUser.findUnique.mockResolvedValue(makeUser('user-1', UserRole.MEMBER));

    expect(await canUserWriteList('user-1', 'list-1')).toBe(true);
  });

  it('returns true for ADMIN', async () => {
    mockList.findUnique.mockResolvedValue(makeList({ ownerId: 'other' }));
    mockUser.findUnique.mockResolvedValue(makeUser('admin', UserRole.ADMIN));

    expect(await canUserWriteList('admin', 'list-1')).toBe(true);
  });

  it('returns true for TEAM_LEAD in the same team for a TEAM list', async () => {
    mockList.findUnique.mockResolvedValue(makeList({
      ownerId: 'other',
      scope: ListScope.TEAM,
      teamId: 'team-1',
    }));
    mockUser.findUnique.mockResolvedValue(makeUser('lead-1', UserRole.TEAM_LEAD));
    mockTeamMember.findUnique.mockResolvedValue({ userId: 'lead-1', teamId: 'team-1', role: UserRole.TEAM_LEAD });

    expect(await canUserWriteList('lead-1', 'list-1')).toBe(true);
  });

  it('returns false for a regular MEMBER in the team', async () => {
    mockList.findUnique.mockResolvedValue(makeList({
      ownerId: 'other',
      scope: ListScope.TEAM,
      teamId: 'team-1',
    }));
    mockUser.findUnique.mockResolvedValue(makeUser('member-1', UserRole.MEMBER));
    mockTeamMember.findUnique.mockResolvedValue({ userId: 'member-1', teamId: 'team-1', role: UserRole.MEMBER });

    expect(await canUserWriteList('member-1', 'list-1')).toBe(false);
  });
});

describe('canUserAccessTask', () => {
  beforeEach(() => jest.clearAllMocks());

  it('delegates to canUserAccessList via the task listId', async () => {
    mockTask.findUnique.mockResolvedValue({ id: 'task-1', listId: 'list-1', deletedAt: null });
    mockList.findUnique.mockResolvedValue(makeList({ ownerId: 'user-1' }));
    mockUser.findUnique.mockResolvedValue(makeUser('user-1', UserRole.MEMBER));

    expect(await canUserAccessTask('user-1', 'task-1')).toBe(true);
  });

  it('returns false when task does not exist', async () => {
    mockTask.findUnique.mockResolvedValue(null);

    expect(await canUserAccessTask('user-1', 'missing')).toBe(false);
  });
});

describe('canUserAccessDoc', () => {
  beforeEach(() => jest.clearAllMocks());

  function makeDoc(overrides = {}) {
    return {
      id: 'doc-1',
      ownerId: 'owner-1',
      visibility: DocVisibility.PRIVATE,
      teamId: null,
      deletedAt: null,
      ...overrides,
    };
  }

  it('returns true for the doc owner', async () => {
    mockDoc.findUnique.mockResolvedValue(makeDoc({ ownerId: 'user-1' }));
    mockUser.findUnique.mockResolvedValue(makeUser('user-1', UserRole.MEMBER));

    expect(await canUserAccessDoc('user-1', 'doc-1')).toBe(true);
  });

  it('returns true for ADMIN', async () => {
    mockDoc.findUnique.mockResolvedValue(makeDoc({ ownerId: 'other' }));
    mockUser.findUnique.mockResolvedValue(makeUser('admin', UserRole.ADMIN));

    expect(await canUserAccessDoc('admin', 'doc-1')).toBe(true);
  });

  it('returns true for ORGANIZATION visibility', async () => {
    mockDoc.findUnique.mockResolvedValue(makeDoc({ ownerId: 'other', visibility: DocVisibility.ORGANIZATION }));
    mockUser.findUnique.mockResolvedValue(makeUser('user-1', UserRole.MEMBER));

    expect(await canUserAccessDoc('user-1', 'doc-1')).toBe(true);
  });

  it('returns true for TEAM visibility when user is a team member', async () => {
    mockDoc.findUnique.mockResolvedValue(makeDoc({
      ownerId: 'other',
      visibility: DocVisibility.TEAM,
      teamId: 'team-1',
    }));
    mockUser.findUnique.mockResolvedValue(makeUser('user-1', UserRole.MEMBER));
    mockTeamMember.findUnique.mockResolvedValue({ userId: 'user-1', teamId: 'team-1' });

    expect(await canUserAccessDoc('user-1', 'doc-1')).toBe(true);
  });

  it('returns false for PRIVATE doc with non-owner user', async () => {
    mockDoc.findUnique.mockResolvedValue(makeDoc({ ownerId: 'other', visibility: DocVisibility.PRIVATE }));
    mockUser.findUnique.mockResolvedValue(makeUser('user-1', UserRole.MEMBER));

    expect(await canUserAccessDoc('user-1', 'doc-1')).toBe(false);
  });
});

describe('canUserWriteDoc', () => {
  beforeEach(() => jest.clearAllMocks());

  function makeDoc(overrides = {}) {
    return {
      id: 'doc-1',
      ownerId: 'owner-1',
      visibility: DocVisibility.PRIVATE,
      teamId: null,
      deletedAt: null,
      ...overrides,
    };
  }

  it('returns true for the doc owner', async () => {
    mockDoc.findUnique.mockResolvedValue(makeDoc({ ownerId: 'user-1' }));
    mockUser.findUnique.mockResolvedValue(makeUser('user-1', UserRole.MEMBER));

    expect(await canUserWriteDoc('user-1', 'doc-1')).toBe(true);
  });

  it('returns true for TEAM_LEAD in the team for a TEAM doc', async () => {
    mockDoc.findUnique.mockResolvedValue(makeDoc({
      ownerId: 'other',
      visibility: DocVisibility.TEAM,
      teamId: 'team-1',
    }));
    mockUser.findUnique.mockResolvedValue(makeUser('lead-1', UserRole.TEAM_LEAD));
    mockTeamMember.findUnique.mockResolvedValue({ userId: 'lead-1', teamId: 'team-1', role: UserRole.TEAM_LEAD });

    expect(await canUserWriteDoc('lead-1', 'doc-1')).toBe(true);
  });

  it('returns false for a regular MEMBER in the team', async () => {
    mockDoc.findUnique.mockResolvedValue(makeDoc({
      ownerId: 'other',
      visibility: DocVisibility.TEAM,
      teamId: 'team-1',
    }));
    mockUser.findUnique.mockResolvedValue(makeUser('member-1', UserRole.MEMBER));
    mockTeamMember.findUnique.mockResolvedValue({ userId: 'member-1', teamId: 'team-1', role: UserRole.MEMBER });

    expect(await canUserWriteDoc('member-1', 'doc-1')).toBe(false);
  });
});
