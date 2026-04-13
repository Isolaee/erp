import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { ChevronRight, User } from 'lucide-react';
import type { Task } from '../../types/api';
import { TaskStatusBadge, TaskPriorityBadge } from './TaskStatusBadge';
import api from '../../lib/api';
import { queryClient } from '../../lib/queryClient';

interface Props {
  task: Task;
}

export function TaskCard({ task }: Props) {
  const assignees = task.assignments?.filter((a) => a.status === 'ACCEPTED') ?? [];
  const pendingCount = task.assignments?.filter((a) => a.status === 'PENDING_ACCEPTANCE').length ?? 0;

  const cycleStatus = async () => {
    const next: Record<string, string> = {
      OPEN: 'IN_PROGRESS',
      IN_PROGRESS: 'DONE',
      DONE: 'OPEN',
      CANCELLED: 'OPEN',
    };
    await api.patch(`/tasks/${task.id}`, { status: next[task.status] });
    queryClient.invalidateQueries({ queryKey: ['lists', task.listId] });
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  return (
    <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-gray-300 transition-colors">
      <button
        onClick={cycleStatus}
        className={clsx(
          'mt-0.5 h-4 w-4 flex-shrink-0 rounded border-2 transition-colors',
          task.status === 'DONE'
            ? 'bg-green-500 border-green-500'
            : task.status === 'IN_PROGRESS'
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-300 hover:border-blue-400',
        )}
        title="Cycle status"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link to={`/tasks/${task.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600 truncate">
            {task.title}
          </Link>
          <TaskStatusBadge status={task.status} />
          <TaskPriorityBadge priority={task.priority} />
          {pendingCount > 0 && (
            <span className="text-xs text-yellow-600 font-medium">{pendingCount} pending</span>
          )}
        </div>
        {task.description && (
          <p className="mt-0.5 text-xs text-gray-500 truncate">{task.description}</p>
        )}
        <div className="mt-1 flex items-center gap-2">
          {(task._count?.subtasks ?? 0) > 0 && (
            <span className="text-xs text-gray-400">{task._count?.subtasks} subtasks</span>
          )}
          {assignees.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <User className="h-3 w-3" />
              {assignees.map((a) => a.assignee?.name).join(', ')}
            </div>
          )}
        </div>
      </div>
      <Link to={`/tasks/${task.id}`} className="text-gray-300 hover:text-gray-500">
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
