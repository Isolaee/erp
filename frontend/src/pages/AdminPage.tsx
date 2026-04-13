import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Check, UserPlus, Users, Plus } from 'lucide-react';
import type { User, Team, Invite } from '../types/api';
import { Badge } from '../components/shared/Badge';
import { Modal } from '../components/shared/Modal';
import { Spinner } from '../components/shared/Spinner';
import api from '../lib/api';
import { queryClient } from '../lib/queryClient';

export function AdminPage() {
  const [tab, setTab] = useState<'users' | 'invites' | 'teams'>('users');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamDesc, setTeamDesc] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: users } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  });

  const { data: invites } = useQuery<Invite[]>({
    queryKey: ['invites'],
    queryFn: () => api.get('/invites').then((r) => r.data),
  });

  const { data: teams } = useQuery<Team[]>({
    queryKey: ['teams'],
    queryFn: () => api.get('/teams').then((r) => r.data),
  });

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/invites', { email: inviteEmail || undefined });
      queryClient.invalidateQueries({ queryKey: ['invites'] });
      setInviteEmail(''); setInviteOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/teams', { name: teamName, description: teamDesc || undefined });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      setTeamName(''); setTeamDesc(''); setTeamOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeInvite = async (id: string) => {
    await api.delete(`/invites/${id}`);
    queryClient.invalidateQueries({ queryKey: ['invites'] });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Admin</h1>

      <div className="flex gap-1 border-b border-gray-200">
        {(['users', 'invites', 'teams'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <button onClick={() => setInviteOpen(true)} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
              <UserPlus className="h-4 w-4" /> Invite User
            </button>
          </div>
          {!users ? <Spinner /> : users.map((u) => (
            <div key={u.id} className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3">
              <div>
                <p className="font-medium text-gray-900">{u.name}</p>
                <p className="text-xs text-gray-500">{u.email}</p>
              </div>
              <Badge variant={u.role === 'ADMIN' ? 'danger' : u.role === 'TEAM_LEAD' ? 'warning' : 'default'}>{u.role}</Badge>
            </div>
          ))}
        </div>
      )}

      {tab === 'invites' && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <button onClick={() => setInviteOpen(true)} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" /> New Invite
            </button>
          </div>
          {!invites ? <Spinner /> : invites.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No invites created yet.</p>
          ) : invites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{inv.email ?? 'Link-based invite'}</p>
                <p className="text-xs text-gray-500">Sent by {inv.sender?.name} · {inv.team?.name ?? 'No team'}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={inv.status === 'PENDING' ? 'warning' : inv.status === 'ACCEPTED' ? 'success' : 'muted'}>
                  {inv.status}
                </Badge>
                {inv.status === 'PENDING' && inv.inviteUrl && (
                  <button
                    onClick={() => handleCopy(inv.inviteUrl!, inv.id)}
                    className="flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    {copiedId === inv.id ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                    Copy link
                  </button>
                )}
                {inv.status === 'PENDING' && (
                  <button onClick={() => handleRevokeInvite(inv.id)} className="text-xs text-red-500 hover:text-red-700">Revoke</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'teams' && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <button onClick={() => setTeamOpen(true)} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
              <Users className="h-4 w-4" /> New Team
            </button>
          </div>
          {!teams ? <Spinner /> : teams.map((t) => (
            <div key={t.id} className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3">
              <div>
                <p className="font-medium text-gray-900">{t.name}</p>
                {t.description && <p className="text-xs text-gray-500">{t.description}</p>}
              </div>
              <span className="text-xs text-gray-400">{t._count?.members ?? 0} members</span>
            </div>
          ))}
        </div>
      )}

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite User">
        <form onSubmit={handleCreateInvite} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email (optional — leave blank for a link-only invite)</label>
            <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" autoFocus />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setInviteOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? 'Creating...' : 'Create Invite'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={teamOpen} onClose={() => setTeamOpen(false)} title="New Team">
        <form onSubmit={handleCreateTeam} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input value={teamName} onChange={(e) => setTeamName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input value={teamDesc} onChange={(e) => setTeamDesc(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setTeamOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={saving || !teamName} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? 'Creating...' : 'Create'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
