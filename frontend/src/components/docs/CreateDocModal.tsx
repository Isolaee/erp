import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '../shared/Modal';
import { Spinner } from '../shared/Spinner';
import api from '../../lib/api';
import type { DocVisibility, Team, RepoFollow } from '../../types/api';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateDocModal({ open, onClose }: Props) {
  const navigate = useNavigate();
  const [title,        setTitle]       = useState('');
  const [visibility,   setVisibility]  = useState<DocVisibility>('PRIVATE');
  const [teamId,       setTeamId]      = useState('');
  const [repoFollowId, setRepoFollowId] = useState('');
  const [saving,       setSaving]      = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) { setTitle(''); setVisibility('PRIVATE'); setTeamId(''); setRepoFollowId(''); }
  }, [open]);

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ['teams'],
    queryFn:  () => api.get('/teams').then((r) => r.data),
    enabled:  open,
  });

  const { data: repos = [] } = useQuery<RepoFollow[]>({
    queryKey: ['teams', teamId, 'repos'],
    queryFn:  () => api.get(`/teams/${teamId}/repos`).then((r) => r.data),
    enabled:  open && !!teamId,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const { data } = await api.post('/docs', {
        title:        title.trim(),
        visibility,
        teamId:       teamId       || undefined,
        repoFollowId: repoFollowId || undefined,
      });
      onClose();
      navigate(`/docs/${data.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Documentation">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. API Authentication Guide"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Visibility</label>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as DocVisibility)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="PRIVATE">Private (only me)</option>
            <option value="TEAM">Team</option>
            <option value="ORGANIZATION">Organization</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Team (optional)</label>
          <select
            value={teamId}
            onChange={(e) => { setTeamId(e.target.value); setRepoFollowId(''); }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— No team —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        {teamId && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Linked repo (optional)</label>
            <select
              value={repoFollowId}
              onChange={(e) => setRepoFollowId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— No repo —</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>{r.owner}/{r.repo}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving && <Spinner className="h-4 w-4" />}
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}
