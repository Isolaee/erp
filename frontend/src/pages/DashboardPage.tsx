import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckSquare, ListTodo, Users, Clock } from 'lucide-react';
import type { Task, TaskList } from '../types/api';
import { TaskCard } from '../components/tasks/TaskCard';
import { Spinner } from '../components/shared/Spinner';
import { EmptyState } from '../components/shared/EmptyState';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';

export function DashboardPage() {
  const { user } = useAuth();

  const { data: myTasks, isLoading: loadingTasks } = useQuery<Task[]>({
    queryKey: ['tasks', 'my'],
    queryFn: () => api.get(`/tasks?assigneeId=${user?.id}&status=IN_PROGRESS`).then((r) => r.data),
    enabled: !!user,
  });

  const { data: pendingTasks } = useQuery<Task[]>({
    queryKey: ['tasks', 'pending-acceptance'],
    queryFn: () => api.get(`/tasks?assigneeId=${user?.id}`).then((r) =>
      r.data.filter((t: Task) => t.assignments?.some((a) => a.assigneeId === user?.id && a.status === 'PENDING_ACCEPTANCE'))
    ),
    enabled: !!user,
  });

  const { data: recentLists } = useQuery<TaskList[]>({
    queryKey: ['lists'],
    queryFn: () => api.get('/lists').then((r) => r.data),
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Welcome back, {user?.name}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <CheckSquare className="h-8 w-8 text-blue-500" />
            <div>
              <p className="text-2xl font-bold text-gray-900">{myTasks?.length ?? 0}</p>
              <p className="text-xs text-gray-500">In progress</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <Clock className="h-8 w-8 text-yellow-500" />
            <div>
              <p className="text-2xl font-bold text-gray-900">{pendingTasks?.length ?? 0}</p>
              <p className="text-xs text-gray-500">Pending acceptance</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <ListTodo className="h-8 w-8 text-green-500" />
            <div>
              <p className="text-2xl font-bold text-gray-900">{recentLists?.length ?? 0}</p>
              <p className="text-xs text-gray-500">Visible lists</p>
            </div>
          </div>
        </div>
      </div>

      {/* Pending assignments */}
      {(pendingTasks?.length ?? 0) > 0 && (
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-3">Awaiting your response</h2>
          <div className="space-y-2">
            {pendingTasks!.map((t) => <TaskCard key={t.id} task={t} />)}
          </div>
        </div>
      )}

      {/* In-progress tasks */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">Your work in progress</h2>
        {loadingTasks ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (myTasks?.length ?? 0) === 0 ? (
          <EmptyState title="Nothing in progress" description="Tasks you accept will appear here." />
        ) : (
          <div className="space-y-2">
            {myTasks!.map((t) => <TaskCard key={t.id} task={t} />)}
          </div>
        )}
      </div>

      {/* Recent lists */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">Recent lists</h2>
          <Link to="/lists" className="text-sm text-blue-600 hover:underline">View all</Link>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(recentLists ?? []).slice(0, 4).map((l) => (
            <Link key={l.id} to={`/lists/${l.id}`} className="rounded-xl border border-gray-200 bg-white p-4 hover:border-blue-300 transition-colors">
              <p className="font-medium text-gray-900 truncate">{l.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{l.scope} · {l._count?.tasks ?? 0} tasks</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
