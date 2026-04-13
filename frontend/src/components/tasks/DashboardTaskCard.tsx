import { Link } from 'react-router-dom';
import { GitBranch, Calendar, User, ArrowRight } from 'lucide-react';
import { Badge } from '../shared/Badge';
import { TaskStatusBadge, TaskPriorityBadge } from './TaskStatusBadge';
import type { TaskAssignmentStatus, TaskStatus, TaskPriority } from '../../types/api';

export interface DashboardCard {
  assignment: {
    id: string;
    status: TaskAssignmentStatus;
    note?: string;
    responseNote?: string;
    createdAt: string;
    assignedById?: string;
    assignee?: { id: string; name: string; avatarUrl?: string };
  };
  task: {
    id: string;
    title: string;
    description?: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate?: string;
    creator?: { id: string; name: string };
  };
  list: {
    id: string;
    title: string;
    scope: string;
  };
  team?: { id: string; name: string } | null;
  repos: Array<{ id: string; owner: string; repo: string }>;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const scopeVariant: Record<string, 'info' | 'warning' | 'muted'> = {
  ORGANIZATION: 'info',
  TEAM: 'warning',
  PERSONAL: 'muted',
};

const assignmentStatusVariant: Record<TaskAssignmentStatus, 'warning' | 'success' | 'danger'> = {
  PENDING_ACCEPTANCE: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'danger',
};

interface Props {
  card: DashboardCard;
}

export function DashboardTaskCard({ card }: Props) {
  const { assignment, task, list, team, repos } = card;
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'DONE';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 hover:border-gray-300 transition-colors">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <Link
          to={`/tasks/${task.id}`}
          className="text-sm font-semibold text-gray-900 hover:text-blue-600 leading-snug"
        >
          {task.title}
        </Link>
        <Link to={`/tasks/${task.id}`} className="shrink-0 text-gray-300 hover:text-gray-500">
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {/* Description snippet */}
      {task.description && (
        <p className="text-xs text-gray-500 line-clamp-2">{task.description}</p>
      )}

      {/* Badges row */}
      <div className="flex flex-wrap gap-1.5">
        <TaskStatusBadge status={task.status} />
        <TaskPriorityBadge priority={task.priority} />
        <Badge variant={assignmentStatusVariant[assignment.status]}>
          {assignment.status.replace('_', ' ')}
        </Badge>
        <Badge variant={scopeVariant[list.scope] ?? 'muted'}>{list.scope}</Badge>
      </div>

      {/* Context: list + team */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        <Link to={`/lists/${list.id}`} className="hover:text-blue-600 font-medium truncate max-w-[180px]">
          {list.title}
        </Link>
        {team && (
          <>
            <span className="text-gray-300">/</span>
            <Link to={`/teams/${team.id}`} className="flex items-center gap-1 hover:text-blue-600">
              <User className="h-3 w-3" />
              {team.name}
            </Link>
          </>
        )}
      </div>

      {/* Repos */}
      {repos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {repos.map((r) => (
            <a
              key={r.id}
              href={`https://github.com/${r.owner}/${r.repo}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-gray-50 border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:border-blue-300 hover:text-blue-600"
            >
              <GitBranch className="h-3 w-3" />
              {r.owner}/{r.repo}
            </a>
          ))}
        </div>
      )}

      {/* Footer: due date + assigned */}
      <div className="flex items-center justify-between text-xs text-gray-400 border-t border-gray-50 pt-2">
        <span>assigned {timeAgo(assignment.createdAt)}</span>
        {task.dueDate && (
          <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-500 font-medium' : ''}`}>
            <Calendar className="h-3 w-3" />
            {isOverdue ? 'Overdue · ' : ''}{formatDate(task.dueDate)}
          </span>
        )}
        {assignment.assignee && (
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {assignment.assignee.name}
          </span>
        )}
      </div>

      {/* Assignment note */}
      {assignment.note && (
        <p className="text-xs italic text-gray-400 border-l-2 border-gray-100 pl-2">
          "{assignment.note}"
        </p>
      )}
    </div>
  );
}
