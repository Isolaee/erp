import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserCheck, UserX, UserPlus } from 'lucide-react';
import type { Task, TaskAssignment, User } from '../../types/api';
import { Badge } from '../shared/Badge';
import { Spinner } from '../shared/Spinner';
import api from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { useAuth } from '../../context/AuthContext';

const statusVariant = {
  PENDING_ACCEPTANCE: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'danger',
} as const;

interface Props {
  task: Task;
}

export function TaskAssignmentPanel({ task }: Props) {
  const { user } = useAuth();
  const [assigneeId, setAssigneeId] = useState('');
  const [note, setNote] = useState('');
  const [assigning, setAssigning] = useState(false);

  const { data: users } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  });

  const handleAssign = async () => {
    if (!assigneeId) return;
    setAssigning(true);
    try {
      await api.post(`/tasks/${task.id}/assign`, { assigneeId, note: note || undefined });
      queryClient.invalidateQueries({ queryKey: ['tasks', task.id] });
      setAssigneeId(''); setNote('');
    } finally {
      setAssigning(false);
    }
  };

  const handleRespond = async (assignmentId: string, status: 'ACCEPTED' | 'REJECTED') => {
    await api.patch(`/tasks/${task.id}/assignments/${assignmentId}`, { status });
    queryClient.invalidateQueries({ queryKey: ['tasks', task.id] });
  };

  const handleWithdraw = async (assignmentId: string) => {
    await api.delete(`/tasks/${task.id}/assignments/${assignmentId}`);
    queryClient.invalidateQueries({ queryKey: ['tasks', task.id] });
  };

  const assignments = task.assignments ?? [];
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-900">Assignments</h3>

      {assignments.length === 0 && (
        <p className="text-sm text-gray-500">No assignments yet.</p>
      )}

      <div className="space-y-2">
        {assignments.map((a: TaskAssignment) => (
          <div key={a.id} className="flex items-center justify-between rounded-lg border border-gray-100 p-3">
            <div>
              <span className="text-sm font-medium text-gray-800">{a.assignee?.name}</span>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant={statusVariant[a.status]}>{a.status.replace('_', ' ')}</Badge>
                {a.note && <span className="text-xs text-gray-500">"{a.note}"</span>}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {a.assigneeId === user?.id && a.status === 'PENDING_ACCEPTANCE' && (
                <>
                  <button onClick={() => handleRespond(a.id, 'ACCEPTED')} className="text-green-600 hover:text-green-700 p-1" title="Accept">
                    <UserCheck className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleRespond(a.id, 'REJECTED')} className="text-red-600 hover:text-red-700 p-1" title="Reject">
                    <UserX className="h-4 w-4" />
                  </button>
                </>
              )}
              {a.assignedById === user?.id && (
                <button onClick={() => handleWithdraw(a.id)} className="text-gray-400 hover:text-gray-600 p-1 text-xs" title="Withdraw">
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Assign form */}
      <div className="border-t border-gray-100 pt-4">
        <h4 className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Assign to</h4>
        <div className="flex gap-2">
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select user...</option>
            {users?.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <button
            onClick={handleAssign}
            disabled={!assigneeId || assigning}
            className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {assigning ? <Spinner className="h-3 w-3" /> : <UserPlus className="h-4 w-4" />}
            Assign
          </button>
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note..."
          className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}
