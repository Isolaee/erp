import { Badge } from '../shared/Badge';
import type { TaskStatus, TaskPriority } from '../../types/api';

const statusVariant = {
  OPEN:        'default',
  IN_PROGRESS: 'info',
  DONE:        'success',
  CANCELLED:   'muted',
} as const;

const priorityVariant = {
  LOW:    'muted',
  MEDIUM: 'default',
  HIGH:   'warning',
  URGENT: 'danger',
} as const;

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge variant={statusVariant[status]}>{status.replace('_', ' ')}</Badge>;
}

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  return <Badge variant={priorityVariant[priority]}>{priority}</Badge>;
}
