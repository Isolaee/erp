import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Sparkles, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { TaskList } from '../types/api';
import { TaskCard } from '../components/tasks/TaskCard';
import { CreateTaskModal } from '../components/tasks/CreateTaskModal';
import { RefinementPanel } from '../components/ai/RefinementPanel';
import { Spinner } from '../components/shared/Spinner';
import { EmptyState } from '../components/shared/EmptyState';
import { Badge } from '../components/shared/Badge';
import api from '../lib/api';

export function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [creating, setCreating] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const { data: list, isLoading, error } = useQuery<TaskList>({
    queryKey: ['lists', id],
    queryFn: () => api.get(`/lists/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  if (isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (error || !list) return <div className="text-red-600 p-4">List not found or access denied.</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/lists" className="text-gray-400 hover:text-gray-600"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{list.title}</h1>
          {list.description && <p className="text-sm text-gray-500 mt-0.5">{list.description}</p>}
        </div>
        <Badge variant={list.scope === 'ORGANIZATION' ? 'info' : list.scope === 'TEAM' ? 'default' : 'muted'}>
          {list.scope}
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Add Task
        </button>
        <button
          onClick={() => setAiOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2 text-sm text-purple-700 hover:bg-purple-100"
        >
          <Sparkles className="h-4 w-4" /> Refine with AI
        </button>
      </div>

      {(list.tasks?.length ?? 0) === 0 ? (
        <EmptyState
          title="No tasks yet"
          description="Add tasks manually or use AI to generate them."
          action={<button onClick={() => setCreating(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">Add Task</button>}
        />
      ) : (
        <div className="space-y-2">
          {list.tasks!.map((task) => <TaskCard key={task.id} task={task} />)}
        </div>
      )}

      <CreateTaskModal open={creating} onClose={() => setCreating(false)} listId={id!} />
      <RefinementPanel open={aiOpen} onClose={() => setAiOpen(false)} targetType="list" targetId={id!} />
    </div>
  );
}
