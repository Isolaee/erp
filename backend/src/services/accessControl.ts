import { DocVisibility, ListScope, ListVisibility, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';

const roleOrder: Record<UserRole, number> = { ADMIN: 3, TEAM_LEAD: 2, MEMBER: 1 };

function hasHigherOrEqualRole(userRole: UserRole, threshold: UserRole): boolean {
  return roleOrder[userRole] >= roleOrder[threshold];
}

export async function canUserAccessList(userId: string, listId: string): Promise<boolean> {
  const list = await prisma.taskList.findUnique({
    where: { id: listId, deletedAt: null },
    include: { ownerUser: { select: { role: true } } },
  });
  if (!list) return false;

  const user = await prisma.user.findUnique({ where: { id: userId, deletedAt: null } });
  if (!user) return false;

  // Admin always has access
  if (user.role === UserRole.ADMIN) return true;

  // Owner always has access
  if (list.ownerId === userId) return true;

  // ORGANIZATION scope + ORGANIZATION visibility → all users
  if (list.scope === ListScope.ORGANIZATION && list.visibility === ListVisibility.ORGANIZATION) {
    return true;
  }

  // ORGANIZATION scope + PRIVATE → only owner (already handled above) + admins
  if (list.scope === ListScope.ORGANIZATION && list.visibility === ListVisibility.PRIVATE) {
    return false;
  }

  // TEAM scope → check team membership
  if (list.scope === ListScope.TEAM && list.teamId) {
    const membership = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId, teamId: list.teamId } },
    });
    if (!membership) return false;

    if (list.visibility === ListVisibility.ORGANIZATION) return true;
    if (list.visibility === ListVisibility.TEAM) return true;
    // PRIVATE team list: only owner (handled above) and team leads/admins
    return hasHigherOrEqualRole(membership.role, UserRole.TEAM_LEAD);
  }

  // PERSONAL scope
  if (list.scope === ListScope.PERSONAL) {
    if (list.visibility === ListVisibility.ORGANIZATION) return true;
    if (list.visibility === ListVisibility.TEAM && list.teamId) {
      const membership = await prisma.teamMember.findUnique({
        where: { userId_teamId: { userId, teamId: list.teamId } },
      });
      if (membership && hasHigherOrEqualRole(membership.role, UserRole.TEAM_LEAD)) return true;
    }
    // PRIVATE personal: only owner (handled above)
    // Team leads can see personal lists of their team members
    if (hasHigherOrEqualRole(user.role, UserRole.TEAM_LEAD)) {
      // Check if user leads a team that the list owner is in
      const ownerTeams = await prisma.teamMember.findMany({ where: { userId: list.ownerId } });
      for (const ownerTeam of ownerTeams) {
        const leadMembership = await prisma.teamMember.findUnique({
          where: { userId_teamId: { userId, teamId: ownerTeam.teamId } },
        });
        if (leadMembership && hasHigherOrEqualRole(leadMembership.role, UserRole.TEAM_LEAD)) {
          return true;
        }
      }
    }
    return false;
  }

  return false;
}

export async function canUserWriteList(userId: string, listId: string): Promise<boolean> {
  const list = await prisma.taskList.findUnique({ where: { id: listId, deletedAt: null } });
  if (!list) return false;

  const user = await prisma.user.findUnique({ where: { id: userId, deletedAt: null } });
  if (!user) return false;

  if (user.role === UserRole.ADMIN) return true;
  if (list.ownerId === userId) return true;

  // Team leads can write to team lists they belong to
  if (list.scope === ListScope.TEAM && list.teamId) {
    const membership = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId, teamId: list.teamId } },
    });
    if (membership && hasHigherOrEqualRole(membership.role, UserRole.TEAM_LEAD)) return true;
  }

  return false;
}

export async function canUserAccessTask(userId: string, taskId: string): Promise<boolean> {
  const task = await prisma.task.findUnique({ where: { id: taskId, deletedAt: null } });
  if (!task) return false;
  return canUserAccessList(userId, task.listId);
}

export async function canUserAccessDoc(userId: string, docId: string): Promise<boolean> {
  const doc = await prisma.doc.findUnique({ where: { id: docId, deletedAt: null } });
  if (!doc) return false;

  const user = await prisma.user.findUnique({ where: { id: userId, deletedAt: null } });
  if (!user) return false;

  if (user.role === UserRole.ADMIN) return true;
  if (doc.ownerId === userId) return true;
  if (doc.visibility === DocVisibility.ORGANIZATION) return true;

  if (doc.visibility === DocVisibility.TEAM && doc.teamId) {
    const membership = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId, teamId: doc.teamId } },
    });
    return !!membership;
  }

  return false;
}

export async function canUserWriteDoc(userId: string, docId: string): Promise<boolean> {
  const doc = await prisma.doc.findUnique({ where: { id: docId, deletedAt: null } });
  if (!doc) return false;

  const user = await prisma.user.findUnique({ where: { id: userId, deletedAt: null } });
  if (!user) return false;

  if (user.role === UserRole.ADMIN) return true;
  if (doc.ownerId === userId) return true;

  if (doc.visibility === DocVisibility.TEAM && doc.teamId) {
    const membership = await prisma.teamMember.findUnique({
      where: { userId_teamId: { userId, teamId: doc.teamId } },
    });
    if (membership && hasHigherOrEqualRole(membership.role, UserRole.TEAM_LEAD)) return true;
  }

  return false;
}
