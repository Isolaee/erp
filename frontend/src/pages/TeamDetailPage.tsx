import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Plus, GitBranch, ExternalLink, KeyRound, Eye, EyeOff, CheckCircle2, Trash2 } from 'lucide-react';
import type { Team, GithubIssue, GithubPR, GithubCommit } from '../types/api';
import { Badge } from '../components/shared/Badge';
import { Spinner } from '../components/shared/Spinner';
import { Modal } from '../components/shared/Modal';
import api from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { useAuth } from '../context/AuthContext';

type Tab = 'members' | 'repos' | 'issues' | 'pulls' | 'commits';

export function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('members');
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<{ owner: string; repo: string } | null>(null);

  // PAT panel state
  const [pat, setPat] = useState('');
  const [showPat, setShowPat] = useState(false);
  const [patSaved, setPatSaved] = useState(false);

  const { data: team, isLoading } = useQuery<Team>({
    queryKey: ['teams', id],
    queryFn: () => api.get(`/teams/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const { data: issues } = useQuery<GithubIssue[]>({
    queryKey: ['github', selectedRepo?.owner, selectedRepo?.repo, 'issues'],
    queryFn: () => api.get(`/github/repos/${selectedRepo!.owner}/${selectedRepo!.repo}/issues`).then((r) => r.data),
    enabled: !!selectedRepo && tab === 'issues',
  });

  const { data: pulls } = useQuery<GithubPR[]>({
    queryKey: ['github', selectedRepo?.owner, selectedRepo?.repo, 'pulls'],
    queryFn: () => api.get(`/github/repos/${selectedRepo!.owner}/${selectedRepo!.repo}/pulls`).then((r) => r.data),
    enabled: !!selectedRepo && tab === 'pulls',
  });

  const { data: commits } = useQuery<GithubCommit[]>({
    queryKey: ['github', selectedRepo?.owner, selectedRepo?.repo, 'commits'],
    queryFn: () => api.get(`/github/repos/${selectedRepo!.owner}/${selectedRepo!.repo}/commits`).then((r) => r.data),
    enabled: !!selectedRepo && tab === 'commits',
  });

  const savePat = useMutation({
    mutationFn: (newPat: string | null) =>
      api.put(`/teams/${id}/github-pat`, { pat: newPat }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', id] });
      setPat('');
      setShowPat(false);
      setPatSaved(true);
      setTimeout(() => setPatSaved(false), 3000);
    },
  });

  const canManage = user?.role === 'ADMIN' ||
    team?.members?.some((m) => m.userId === user?.id && m.role !== 'MEMBER');

  const handleAddRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post(`/teams/${id}/repos`, { owner, repo });
    queryClient.invalidateQueries({ queryKey: ['teams', id] });
    setOwner(''); setRepo(''); setAddRepoOpen(false);
  };

  const handleRemoveRepo = async (repoId: string) => {
    await api.delete(`/teams/${id}/repos/${repoId}`);
    queryClient.invalidateQueries({ queryKey: ['teams', id] });
  };

  const handleSavePat = (e: React.FormEvent) => {
    e.preventDefault();
    if (pat.trim()) savePat.mutate(pat.trim());
  };

  const handleRemovePat = () => {
    if (confirm('Remove the team PAT? GitHub data for private repos will stop working.')) {
      savePat.mutate(null);
    }
  };

  if (isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!team) return <div className="text-red-600 p-4">Team not found.</div>;

  const tabs: Tab[] = ['members', 'repos', ...(selectedRepo ? ['issues', 'pulls', 'commits'] as Tab[] : [])];

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/teams" className="text-gray-400 hover:text-gray-600"><ArrowLeft className="h-5 w-5" /></Link>
        <h1 className="text-xl font-bold text-gray-900">{team.name}</h1>
        {team.description && <p className="text-sm text-gray-500">— {team.description}</p>}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
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

      {tab === 'members' && (
        <div className="space-y-2">
          {team.members?.map((m) => (
            <div key={m.id} className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3">
              <div>
                <p className="font-medium text-gray-900">{m.user?.name}</p>
                <p className="text-xs text-gray-500">{m.user?.email}</p>
              </div>
              <Badge variant={m.role === 'ADMIN' ? 'danger' : m.role === 'TEAM_LEAD' ? 'warning' : 'default'}>
                {m.role}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {tab === 'repos' && (
        <div className="space-y-4">

          {/* ── GitHub Access Token ─────────────────────────────────────── */}
          {canManage && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-1">
                <KeyRound className="h-4 w-4 text-gray-400" />
                <h3 className="text-sm font-semibold text-gray-900">GitHub Access Token</h3>
                {team.hasGithubPat ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-200">
                    <CheckCircle2 className="h-3 w-3" /> Configured
                  </span>
                ) : (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                    Not set
                  </span>
                )}
                {patSaved && (
                  <span className="ml-auto text-xs text-green-600">Saved!</span>
                )}
              </div>
              <p className="text-xs text-gray-400 mb-3">
                Used for all GitHub API calls on this team's repos. Needs{' '}
                <code className="rounded bg-gray-100 px-1">repo</code> scope for private repositories.
              </p>
              <form onSubmit={handleSavePat} className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showPat ? 'text' : 'password'}
                    value={pat}
                    onChange={(e) => setPat(e.target.value)}
                    placeholder={team.hasGithubPat ? 'Enter new token to replace…' : 'ghp_…'}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-9 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPat((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                    aria-label={showPat ? 'Hide token' : 'Show token'}
                  >
                    {showPat ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={!pat.trim() || savePat.isPending}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savePat.isPending ? 'Saving…' : 'Save'}
                </button>
                {team.hasGithubPat && (
                  <button
                    type="button"
                    onClick={handleRemovePat}
                    disabled={savePat.isPending}
                    className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                    title="Remove PAT"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </form>
              {savePat.isError && (
                <p className="mt-2 text-xs text-red-600">Failed to save. Please try again.</p>
              )}
            </div>
          )}

          {/* ── Followed repos ──────────────────────────────────��──────── */}
          {canManage && (
            <button
              onClick={() => setAddRepoOpen(true)}
              className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 w-full"
            >
              <Plus className="h-4 w-4" /> Follow a GitHub repository
            </button>
          )}
          {(team.repoFollows?.length ?? 0) === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No repos followed yet.</p>
          ) : (
            team.repoFollows!.map((r) => (
              <div key={r.id} className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3">
                <div className="flex items-center gap-3">
                  <GitBranch className="h-5 w-5 text-gray-400" />
                  <button
                    onClick={() => { setSelectedRepo({ owner: r.owner, repo: r.repo }); setTab('issues'); }}
                    className="font-medium text-gray-900 hover:text-blue-600"
                  >
                    {r.owner}/{r.repo}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`https://github.com/${r.owner}/${r.repo}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  {canManage && (
                    <button
                      onClick={() => handleRemoveRepo(r.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'issues' && selectedRepo && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 font-medium">{selectedRepo.owner}/{selectedRepo.repo} — Open Issues</p>
          {!issues ? <Spinner /> : issues.map((i) => (
            <a key={i.number} href={i.url} target="_blank" rel="noreferrer" className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3 hover:border-blue-200">
              <div>
                <span className="text-xs text-gray-400 mr-2">#{i.number}</span>
                <span className="text-sm text-gray-900">{i.title}</span>
              </div>
              <ExternalLink className="h-3 w-3 text-gray-400" />
            </a>
          ))}
        </div>
      )}

      {tab === 'pulls' && selectedRepo && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 font-medium">{selectedRepo.owner}/{selectedRepo.repo} — Open PRs</p>
          {!pulls ? <Spinner /> : pulls.map((p) => (
            <a key={p.number} href={p.url} target="_blank" rel="noreferrer" className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3 hover:border-blue-200">
              <div>
                <span className="text-xs text-gray-400 mr-2">#{p.number}</span>
                <span className="text-sm text-gray-900">{p.title}</span>
                {p.draft && <Badge variant="muted" className="ml-2">Draft</Badge>}
              </div>
              <span className="text-xs text-gray-400">{p.author}</span>
            </a>
          ))}
        </div>
      )}

      {tab === 'commits' && selectedRepo && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 font-medium">{selectedRepo.owner}/{selectedRepo.repo} — Recent Commits</p>
          {!commits ? <Spinner /> : commits.map((c) => (
            <a key={c.sha} href={c.url} target="_blank" rel="noreferrer" className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3 hover:border-blue-200">
              <div>
                <span className="font-mono text-xs text-gray-400 mr-2">{c.sha}</span>
                <span className="text-sm text-gray-900">{c.message}</span>
              </div>
              <span className="text-xs text-gray-400">{c.author}</span>
            </a>
          ))}
        </div>
      )}

      <Modal open={addRepoOpen} onClose={() => setAddRepoOpen(false)} title="Follow Repository">
        <form onSubmit={handleAddRepo} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Owner</label>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. facebook" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Repository</label>
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="e.g. react" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAddRepoOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
            <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">Follow</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
