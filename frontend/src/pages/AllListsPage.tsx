import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Lock, Users, Building2 } from 'lucide-react';
import type { TaskList, ListScope, Team } from '../types/api';
import { Spinner } from '../components/shared/Spinner';
import { EmptyState } from '../components/shared/EmptyState';
import { Modal } from '../components/shared/Modal';
import { Badge } from '../components/shared/Badge';
import api from '../lib/api';
import { queryClient } from '../lib/queryClient';

const scopeIcon = {
  ORGANIZATION: <Building2 className="h-4 w-4" />,
  TEAM:         <Users className="h-4 w-4" />,
  PERSONAL:     <Lock className="h-4 w-4" />,
};
const scopeVariant = { ORGANIZATION: 'info', TEAM: 'default', PERSONAL: 'muted' } as const;

export function AllListsPage() {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<ListScope>('PERSONAL');
  const [teamId, setTeamId] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: teams } = useQuery<Team[]>({
    queryKey: ['teams'],
    queryFn: () => api.get('/teams').then((r) => r.data),
    enabled: creating,
  });

  const { data: lists, isLoading } = useQuery<TaskList[]>({
    queryKey: ['lists'],
    queryFn: () => api.get('/lists').then((r) => r.data),
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    if (scope === 'TEAM' && !teamId) return;
    setSaving(true);
    try {
      await api.post('/lists', {
        title: title.trim(),
        scope,
        visibility: scope === 'PERSONAL' ? 'PRIVATE' : 'ORGANIZATION',
        ...(scope === 'TEAM' && { teamId }),
      });
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      setTitle(''); setScope('PERSONAL'); setTeamId(''); setCreating(false);
    } finally {
      setSaving(false);
    }
  };

  const grouped = {
    ORGANIZATION: lists?.filter((l) => l.scope === 'ORGANIZATION') ?? [],
    TEAM:         lists?.filter((l) => l.scope === 'TEAM') ?? [],
    PERSONAL:     lists?.filter((l) => l.scope === 'PERSONAL') ?? [],
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Task Lists</h1>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> New List
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (lists?.length ?? 0) === 0 ? (
        <EmptyState title="No lists yet" description="Create your first task list to get started." action={
          <button onClick={() => setCreating(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">New List</button>
        } />
      ) : (
        (['ORGANIZATION', 'TEAM', 'PERSONAL'] as ListScope[]).map((scopeKey) =>
          grouped[scopeKey].length > 0 ? (
            <div key={scopeKey}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
                {scopeIcon[scopeKey]} {scopeKey}
              </h2>
              <div className="space-y-2">
                {grouped[scopeKey].map((l) => (
                  <Link
                    key={l.id}
                    to={`/lists/${l.id}`}
                    className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-blue-300 transition-colors"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{l.title}</p>
                      {l.description && <p className="text-xs text-gray-500 mt-0.5 truncate max-w-sm">{l.description}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={scopeVariant[l.scope]}>{l.visibility}</Badge>
                      <span className="text-xs text-gray-400">{l._count?.tasks ?? 0} tasks</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ) : null
        )
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New List">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Scope</label>
            <select
              value={scope}
              onChange={(e) => { setScope(e.target.value as ListScope); setTeamId(''); }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="PERSONAL">Personal</option>
              <option value="TEAM">Team</option>
              <option value="ORGANIZATION">Organization</option>
            </select>
          </div>
          {scope === 'TEAM' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Team</label>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a team…</option>
                {teams?.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCreating(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={saving || !title.trim() || (scope === 'TEAM' && !teamId)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
