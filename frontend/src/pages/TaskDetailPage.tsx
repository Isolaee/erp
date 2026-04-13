import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Plus, Sparkles, Pencil } from 'lucide-react';
import type { Task } from '../types/api';
import { TaskStatusBadge, TaskPriorityBadge } from '../components/tasks/TaskStatusBadge';
import { TaskAssignmentPanel } from '../components/tasks/TaskAssignmentPanel';
import { CreateTaskModal } from '../components/tasks/CreateTaskModal';
import { RefinementPanel } from '../components/ai/RefinementPanel';
import { TaskCard } from '../components/tasks/TaskCard';
import { Spinner } from '../components/shared/Spinner';
import api from '../lib/api';
import { queryClient } from '../lib/queryClient';

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [addingSub, setAddingSub] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState('');

  const { data: task, isLoading } = useQuery<Task>({
    queryKey: ['tasks', id],
    queryFn: () => api.get(`/tasks/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  if (isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!task) return <div className="text-red-600 p-4">Task not found.</div>;

  const saveDesc = async () => {
    await api.patch(`/tasks/${task.id}`, { description: desc });
    queryClient.invalidateQueries({ queryKey: ['tasks', id] });
    setEditingDesc(false);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        {task.list && (
          <Link to={`/lists/${task.listId}`} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        )}
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{task.title}</h1>
          <p className="text-xs text-gray-400 mt-0.5">in {task.list?.title}</p>
        </div>
        <div className="flex items-center gap-2">
          <TaskStatusBadge status={task.status} />
          <TaskPriorityBadge priority={task.priority} />
        </div>
      </div>

      {/* Description */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-700">Description</h3>
          <button onClick={() => { setDesc(task.description ?? ''); setEditingDesc(true); }} className="text-gray-400 hover:text-gray-600">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
        {editingDesc ? (
          <div>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <button onClick={saveDesc} className="rounded-lg bg-blue-600 px-3 py-1 text-xs text-white">Save</button>
              <button onClick={() => setEditingDesc(false)} className="rounded-lg border border-gray-300 px-3 py-1 text-xs">Cancel</button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{task.description ?? <span className="text-gray-400 italic">No description</span>}</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Subtasks */}
        <div className="col-span-2 bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">Subtasks ({task.subtasks?.length ?? 0})</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAiOpen(true)}
                className="flex items-center gap-1 rounded border border-purple-200 bg-purple-50 px-2 py-1 text-xs text-purple-600 hover:bg-purple-100"
              >
                <Sparkles className="h-3 w-3" /> AI
              </button>
              <button
                onClick={() => setAddingSub(true)}
                className="flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                <Plus className="h-3 w-3" /> Add
              </button>
            </div>
          </div>
          {(task.subtasks?.length ?? 0) === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No subtasks</p>
          ) : (
            <div className="space-y-2">
              {task.subtasks!.map((sub) => <TaskCard key={sub.id} task={sub} />)}
            </div>
          )}
        </div>

        {/* Assignments */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <TaskAssignmentPanel task={task} />
        </div>
      </div>

      <CreateTaskModal open={addingSub} onClose={() => setAddingSub(false)} listId={task.listId} parentId={task.id} />
      <RefinementPanel open={aiOpen} onClose={() => setAiOpen(false)} targetType="task" targetId={id!} />
    </div>
  );
}
