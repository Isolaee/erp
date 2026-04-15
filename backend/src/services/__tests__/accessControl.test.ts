import {
  canUserAccessList,
  canUserWriteList,
  canUserAccessTask,
  canUserAccessDoc,
  canUserWriteDoc,
} from '../accessControl';
import { prisma } from '../../lib/prisma';
import { DocVisibility, ListScope, ListVisibility, UserRole } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mock the Prisma singleton – no real DB connection required
// ---------------------------------------------------------------------------
jest.mock('../../lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    teamMember: { findUnique: jest.fn(), findMany: jest.fn() },
    doc: { findUnique: jest.fn() },
    task: { findUnique: jest.fn() },
  },
}));

// ---------------------------------------------------------------------------
// Typed helpers to keep casting in one place
// ---------------------------------------------------------------------------
const mockTaskList = () => (prisma.taskList.findUnique as jest.Mock);
const mockUser = () => (prisma.user.findUnique as jest.Mock);
const mockTeamMemberUnique = () => (prisma.teamMember.findUnique as jest.Mock);
const mockTeamMemberMany = () => (prisma.teamMember.findMany as jest.Mock);
const mockDoc = () => (prisma.doc.findUnique as jest.Mock);
const mockTask = () => (prisma.task.findUnique as jest.Mock);

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------
const makeList = (overrides: Record<string, unknown> = {}) => ({
  id: 'list-1',
  title: 'My List',
  scope: ListScope.ORGANIZATION,
  visibility: ListVisibility.ORGANIZATION,
  ownerId: 'owner-1',
  teamId: null,
  deletedAt: null,
  ownerUser: { role: UserRole.MEMBER },
  ...overrides,
});

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  email: 'user@test.com',
  role: UserRole.MEMBER,
  deletedAt: null,
  ...overrides,
});

const makeMembership = (overrides: Record<string, unknown> = {}) => ({
  id: 'mem-1',
  userId: 'user-1',
  teamId: 'team-1',
  role: UserRole.MEMBER,
  ...overrides,
});

const makeDoc = (overrides: Record<string, unknown> = {}) => ({
  id: 'doc-1',
  title: 'My Doc',
  visibility: DocVisibility.ORGANIZATION,
  ownerId: 'owner-1',
  teamId: null,
  deletedAt: null,
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

// ===========================================================================
// canUserAccessList
// ===========================================================================
describe('canUserAccessList', () => {
  it('returns false when list does not exist', async () => {
    mockTaskList().mockResolvedValue(null);
    expect(await canUserAccessList('user-1', 'list-1')).toBe(false);
  });

  it('returns false when user does not exist', async () => {
    mockTaskList().mockResolvedValue(makeList());
    mockUser().mockResolvedValue(null);
    expect(await canUserAccessList('user-1', 'list-1')).toBe(false);
  });

  it('grants ADMIN access regardless of scope/visibility', async () => {
    mockTaskList().mockResolvedValue(
      makeList({ scope: ListScope.PERSONAL, visibility: ListVisibility.PRIVATE }),
    );
    mockUser().mockResolvedValue(makeUser({ id: 'admin-1', role: UserRole.ADMIN }));
    expect(await canUserAccessList('admin-1', 'list-1')).toBe(true);
  });

  it('grants list owner access regardless of visibility', async () => {
    mockTaskList().mockResolvedValue(
      makeList({ ownerId: 'user-1', visibility: ListVisibility.PRIVATE }),
    );
    mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
    expect(await canUserAccessList('user-1', 'list-1')).toBe(true);
  });

  describe('ORGANIZATION scope', () => {
    it('ORGANIZATION visibility → true for any authenticated user', async () => {
      mockTaskList().mockResolvedValue(
        makeList({ scope: ListScope.ORGANIZATION, visibility: ListVisibility.ORGANIZATION }),
      );
      mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
      expect(await canUserAccessList('user-1', 'list-1')).toBe(true);
    });

    it('PRIVATE visibility → false for non-owner non-admin', async () => {
      mockTaskList().mockResolvedValue(
        makeList({
          scope: ListScope.ORGANIZATION,
          visibility: ListVisibility.PRIVATE,
          ownerId: 'owner-1',
        }),
      );
      mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
      expect(await canUserAccessList('user-1', 'list-1')).toBe(false);
    });
  });

  describe('TEAM scope', () => {
    it('non-member → false', async () => {
      mockTaskList().mockResolvedValue(
        makeList({ scope: ListScope.TEAM, visibility: ListVisibility.TEAM, teamId: 'team-1' }),
      );
      mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
      mockTeamMemberUnique().mockResolvedValue(null);
      expect(await canUserAccessList('user-1', 'list-1')).toBe(false);
    });

    it('member + ORGANIZATION visibility → true', async () => {
      mockTaskList().mockResolvedValue(
        makeList({
          scope: ListScope.TEAM,
          visibility: ListVisibility.ORGANIZATION,
          teamId: 'team-1',
        }),
      );
      mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
      mockTeamMemberUnique().mockResolvedValue(makeMembership({ role: UserRole.MEMBER }));
      expect(await canUserAccessList('user-1', 'list-1')).toBe(true);
    });

    it('member + TEAM visibility → true', async () => {
      mockTaskList().mockResolvedValue(
        makeList({ scope: ListScope.TEAM, visibility: ListVisibility.TEAM, teamId: 'team-1' }),
      );
      mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
      mockTeamMemberUnique().mockResolvedValue(makeMembership({ role: UserRole.MEMBER }));
      expect(await canUserAccessList('user-1', 'list-1')).toBe(true);
    });

    it('PRIVATE + MEMBER role → false', async () => {
      mockTaskList().mockResolvedValue(
        makeList({
          scope: ListScope.TEAM,
          visibility: ListVisibility.PRIVATE,
          teamId: 'team-1',
          ownerId: 'owner-1',
        }),
      );
      mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
      mockTeamMemberUnique().mockResolvedValue(makeMembership({ role: UserRole.MEMBER }));
      expect(await canUserAccessList('user-1', 'list-1')).toBe(false);
    });

    it('PRIVATE + TEAM_LEAD role → true', async () => {
      mockTaskList().mockResolvedValue(
        makeList({
          scope: ListScope.TEAM,
          visibility: ListVisibility.PRIVATE,
          teamId: 'team-1',
          ownerId: 'owner-1',
        }),
      );
      mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
      mockTeamMemberUnique().mockResolvedValue(makeMembership({ role: UserRole.TEAM_LEAD }));
      expect(await canUserAccessList('user-1', 'list-1')).toBe(true);
    });
  });

  describe('PERSONAL scope', () => {
    it('ORGANIZATION visibility → true for any user', async () => {
      mockTaskList().mockResolvedValue(
        makeList({
          scope: ListScope.PERSONAL,
          visibility: ListVisibility.ORGANIZATION,
          ownerId: 'owner-1',
        }),
      );
      mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
      expect(await canUserAccessList('user-1', 'list-1')).toBe(true);
    });

    it('TEAM visibility + TEAM_LEAD membership → true', async () => {
      mockTaskList().mockResolvedValue(
        makeList({
          scope: ListScope.PERSONAL,
          visibility: ListVisibility.TEAM,
          teamId: 'team-1',
          ownerId: 'owner-1',
        }),
      );
      mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
      mockTeamMemberUnique().mockResolvedValue(makeMembership({ role: UserRole.TEAM_LEAD }));
      expect(await canUserAccessList('user-1', 'list-1')).toBe(true);
    });

    it('TEAM visibility + MEMBER role → falls through to team lead check', async () => {
      mockTaskList().mockResolvedValue(
        makeList({
          scope: ListScope.PERSONAL,
          visibility: ListVisibility.TEAM,
          teamId: 'team-1',
          ownerId: 'owner-1',
        }),
      );
      mockUser().mockResolvedValue(makeUser({ id: 'user-1', role: UserRole.MEMBER }));
      // First call: TEAM visibility membership check → MEMBER role
      mockTeamMemberUnique().mockResolvedValue(makeMembership({ role: UserRole.MEMBER }));
      // teamMember.findMany for global team-lead check → no teams (MEMBER role skips this block)
      expect(await canUserAccessList('user-1', 'list-1')).toBe(false);
    });

    it('PRIVATE + global TEAM_LEAD who leads a team the owner belongs to → true', async () => {
      mockTaskList().mockResolvedValue(
        makeList({
          scope: ListScope.PERSONAL,
          visibility: ListVisibility.PRIVATE,
          ownerId: 'owner-1',
        }),
      );
      mockUser().mockResolvedValue(makeUser({ id: 'user-1', role: UserRole.TEAM_LEAD }));
      // findMany: owner's teams
      mockTeamMemberMany().mockResolvedValue([{ teamId: 'team-1' }]);
      // findUnique: check if viewer is a TEAM_LEAD in that team
      mockTeamMemberUnique().mockResolvedValue(makeMembership({ role: UserRole.TEAM_LEAD }));
      expect(await canUserAccessList('user-1', 'list-1')).toBe(true);
    });

    it('PRIVATE + global TEAM_LEAD but not in any of owner\'s teams → false', async () => {
      mockTaskList().mockResolvedValue(
        makeList({
          scope: ListScope.PERSONAL,
          visibility: ListVisibility.PRIVATE,
          ownerId: 'owner-1',
        }),
      );
      mockUser().mockResolvedValue(makeUser({ id: 'user-1', role: UserRole.TEAM_LEAD }));
      mockTeamMemberMany().mockResolvedValue([{ teamId: 'team-1' }]);
      mockTeamMemberUnique().mockResolvedValue(null);
      expect(await canUserAccessList('user-1', 'list-1')).toBe(false);
    });

    it('PRIVATE + plain MEMBER → false', async () => {
      mockTaskList().mockResolvedValue(
        makeList({
          scope: ListScope.PERSONAL,
          visibility: ListVisibility.PRIVATE,
          ownerId: 'owner-1',
        }),
      );
      mockUser().mockResolvedValue(makeUser({ id: 'user-1', role: UserRole.MEMBER }));
      expect(await canUserAccessList('user-1', 'list-1')).toBe(false);
    });
  });
});

// ===========================================================================
// canUserWriteList
// ===========================================================================
describe('canUserWriteList', () => {
  it('returns false when list not found', async () => {
    mockTaskList().mockResolvedValue(null);
    expect(await canUserWriteList('user-1', 'list-1')).toBe(false);
  });

  it('returns false when user not found', async () => {
    mockTaskList().mockResolvedValue(makeList());
    mockUser().mockResolvedValue(null);
    expect(await canUserWriteList('user-1', 'list-1')).toBe(false);
  });

  it('grants ADMIN write access', async () => {
    mockTaskList().mockResolvedValue(makeList({ ownerId: 'owner-1' }));
    mockUser().mockResolvedValue(makeUser({ id: 'admin-1', role: UserRole.ADMIN }));
    expect(await canUserWriteList('admin-1', 'list-1')).toBe(true);
  });

  it('grants owner write access', async () => {
    mockTaskList().mockResolvedValue(makeList({ ownerId: 'user-1' }));
    mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
    expect(await canUserWriteList('user-1', 'list-1')).toBe(true);
  });

  it('TEAM scope + TEAM_LEAD membership → true', async () => {
    mockTaskList().mockResolvedValue(
      makeList({ scope: ListScope.TEAM, teamId: 'team-1', ownerId: 'owner-1' }),
    );
    mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
    mockTeamMemberUnique().mockResolvedValue(makeMembership({ role: UserRole.TEAM_LEAD }));
    expect(await canUserWriteList('user-1', 'list-1')).toBe(true);
  });

  it('TEAM scope + MEMBER role → false', async () => {
    mockTaskList().mockResolvedValue(
      makeList({ scope: ListScope.TEAM, teamId: 'team-1', ownerId: 'owner-1' }),
    );
    mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
    mockTeamMemberUnique().mockResolvedValue(makeMembership({ role: UserRole.MEMBER }));
    expect(await canUserWriteList('user-1', 'list-1')).toBe(false);
  });

  it('PERSONAL scope + non-owner → false', async () => {
    mockTaskList().mockResolvedValue(
      makeList({ scope: ListScope.PERSONAL, ownerId: 'owner-1' }),
    );
    mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
    expect(await canUserWriteList('user-1', 'list-1')).toBe(false);
  });
});

// ===========================================================================
// canUserAccessTask
// ===========================================================================
describe('canUserAccessTask', () => {
  it('returns false when task does not exist', async () => {
    mockTask().mockResolvedValue(null);
    expect(await canUserAccessTask('user-1', 'task-1')).toBe(false);
  });

  it('delegates to canUserAccessList', async () => {
    mockTask().mockResolvedValue({ id: 'task-1', listId: 'list-1', deletedAt: null });
    mockTaskList().mockResolvedValue(
      makeList({ scope: ListScope.ORGANIZATION, visibility: ListVisibility.ORGANIZATION }),
    );
    mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
    expect(await canUserAccessTask('user-1', 'task-1')).toBe(true);
  });
});

// ===========================================================================
// canUserAccessDoc
// ===========================================================================
describe('canUserAccessDoc', () => {
  it('returns false when doc does not exist', async () => {
    mockDoc().mockResolvedValue(null);
    expect(await canUserAccessDoc('user-1', 'doc-1')).toBe(false);
  });

  it('returns false when user does not exist', async () => {
    mockDoc().mockResolvedValue(makeDoc());
    mockUser().mockResolvedValue(null);
    expect(await canUserAccessDoc('user-1', 'doc-1')).toBe(false);
  });

  it('grants ADMIN access', async () => {
    mockDoc().mockResolvedValue(makeDoc({ visibility: DocVisibility.PRIVATE, ownerId: 'owner-1' }));
    mockUser().mockResolvedValue(makeUser({ id: 'admin-1', role: UserRole.ADMIN }));
    expect(await canUserAccessDoc('admin-1', 'doc-1')).toBe(true);
  });

  it('grants doc owner access', async () => {
    mockDoc().mockResolvedValue(makeDoc({ visibility: DocVisibility.PRIVATE, ownerId: 'user-1' }));
    mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
    expect(await canUserAccessDoc('user-1', 'doc-1')).toBe(true);
  });

  it('ORGANIZATION visibility → true for any user', async () => {
    mockDoc().mockResolvedValue(makeDoc({ visibility: DocVisibility.ORGANIZATION, ownerId: 'owner-1' }));
    mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
    expect(await canUserAccessDoc('user-1', 'doc-1')).toBe(true);
  });

  it('TEAM visibility + team member → true', async () => {
    mockDoc().mockResolvedValue(
      makeDoc({ visibility: DocVisibility.TEAM, teamId: 'team-1', ownerId: 'owner-1' }),
    );
    mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
    mockTeamMemberUnique().mockResolvedValue(makeMembership());
    expect(await canUserAccessDoc('user-1', 'doc-1')).toBe(true);
  });

  it('TEAM visibility + non-member → false', async () => {
    mockDoc().mockResolvedValue(
      makeDoc({ visibility: DocVisibility.TEAM, teamId: 'team-1', ownerId: 'owner-1' }),
    );
    mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
    mockTeamMemberUnique().mockResolvedValue(null);
    expect(await canUserAccessDoc('user-1', 'doc-1')).toBe(false);
  });

  it('PRIVATE + non-owner non-admin → false', async () => {
    mockDoc().mockResolvedValue(makeDoc({ visibility: DocVisibility.PRIVATE, ownerId: 'owner-1' }));
    mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
    expect(await canUserAccessDoc('user-1', 'doc-1')).toBe(false);
  });
});

// ===========================================================================
// canUserWriteDoc
// ===========================================================================
describe('canUserWriteDoc', () => {
  it('returns false when doc not found', async () => {
    mockDoc().mockResolvedValue(null);
    expect(await canUserWriteDoc('user-1', 'doc-1')).toBe(false);
  });

  it('grants ADMIN write', async () => {
    mockDoc().mockResolvedValue(makeDoc({ ownerId: 'owner-1' }));
    mockUser().mockResolvedValue(makeUser({ id: 'admin-1', role: UserRole.ADMIN }));
    expect(await canUserWriteDoc('admin-1', 'doc-1')).toBe(true);
  });

  it('grants owner write', async () => {
    mockDoc().mockResolvedValue(makeDoc({ ownerId: 'user-1' }));
    mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
    expect(await canUserWriteDoc('user-1', 'doc-1')).toBe(true);
  });

  it('TEAM visibility + TEAM_LEAD member → true', async () => {
    mockDoc().mockResolvedValue(
      makeDoc({ visibility: DocVisibility.TEAM, teamId: 'team-1', ownerId: 'owner-1' }),
    );
    mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
    mockTeamMemberUnique().mockResolvedValue(makeMembership({ role: UserRole.TEAM_LEAD }));
    expect(await canUserWriteDoc('user-1', 'doc-1')).toBe(true);
  });

  it('TEAM visibility + MEMBER role → false', async () => {
    mockDoc().mockResolvedValue(
      makeDoc({ visibility: DocVisibility.TEAM, teamId: 'team-1', ownerId: 'owner-1' }),
    );
    mockUser().mockResolvedValue(makeUser({ id: 'user-1' }));
    mockTeamMemberUnique().mockResolvedValue(makeMembership({ role: UserRole.MEMBER }));
    expect(await canUserWriteDoc('user-1', 'doc-1')).toBe(false);
  });
});
