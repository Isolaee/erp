import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';

const roleOrder: Record<UserRole, number> = {
  ADMIN: 3,
  TEAM_LEAD: 2,
  MEMBER: 1,
};

export function requireRole(minRole: UserRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }
    if (roleOrder[req.user.role] < roleOrder[minRole]) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
