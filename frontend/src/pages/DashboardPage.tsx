import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Building2, Users, User } from 'lucide-react';
import { Spinner } from '../components/shared/Spinner';
import { EmptyState } from '../components/shared/EmptyState';
import { DashboardTaskCard, type DashboardCard } from '../components/tasks/DashboardTaskCard';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import type { Team } from '../types/api';

type Tab = 'personal' | 'teams' | 'org';

// ─── Personal tab ────────────────────────────────────────────────────────────

function PersonalDashboard() {
  const { data, isLoading } = useQuery<DashboardCard[]>({
    queryKey: ['dashboard', 'personal'],
    queryFn: () => api.get('/dashboard/personal').then((r) => r.data),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!data?.length) {
    return (
      <EmptyState
        title="No assigned tasks yet"
        description="Tasks assigned to you will appear here."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">3 most recently assigned to you</p>
      {data.map((card) => <DashboardTaskCard key={card.assignment.id} card={card} />)}
    </div>
  );
}

// ─── Single team section (used inside Teams tab) ──────────────────────────────

function TeamSection({ team }: { team: Team }) {
  const { data, isLoading } = useQuery<DashboardCard[]>({
    queryKey: ['dashboard', 'team', team.id],
    queryFn: () => api.get(`/dashboard/team/${team.id}`).then((r) => r.data),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Link
          to={`/teams/${team.id}`}
          className="flex items-center gap-2 text-sm font-semibold text-gray-800 hover:text-blue-600"
        >
          <Users className="h-4 w-4 text-gray-400" />
          {team.name}
        </Link>
        <span className="text-xs text-gray-400">{team._count?.members ?? 0} members</span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4"><Spinner /></div>
      ) : !data?.length ? (
        <p className="text-xs text-gray-400 py-2 pl-1">No assigned tasks in this team yet.</p>
      ) : (
        <div className="space-y-2">
          {data.map((card) => <DashboardTaskCard key={card.assignment.id} card={card} />)}
        </div>
      )}
    </div>
  );
}

function TeamsDashboard() {
  const { user } = useAuth();

  const { data: teams, isLoading } = useQuery<Team[]>({
    queryKey: ['teams'],
    queryFn: () => api.get('/teams').then((r) => r.data),
    enabled: !!user,
  });

  if (isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!teams?.length) {
    return (
      <EmptyState
        title="No teams yet"
        description="You'll see your teams' recent assignments here once you join a team."
      />
    );
  }

  return (
    <div className="space-y-8">
      {teams.map((team) => (
        <TeamSection key={team.id} team={team} />
      ))}
    </div>
  );
}

// ─── Organization tab ─────────────────────────────────────────────────────────

function OrgDashboard() {
  const { data, isLoading } = useQuery<DashboardCard[]>({
    queryKey: ['dashboard', 'org'],
    queryFn: () => api.get('/dashboard/org').then((r) => r.data),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!data?.length) {
    return (
      <EmptyState
        title="No org-wide assignments yet"
        description="Assignments in organization-scoped lists will appear here."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">3 most recently assigned across the organization</p>
      {data.map((card) => <DashboardTaskCard key={card.assignment.id} card={card} />)}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'personal', label: 'Personal',     icon: User },
  { id: 'teams',    label: 'Teams',        icon: Users },
  { id: 'org',      label: 'Organization', icon: Building2 },
];

export function DashboardPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('personal');

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Welcome back, {user?.name}</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {tab === 'personal' && <PersonalDashboard />}
        {tab === 'teams'    && <TeamsDashboard />}
        {tab === 'org'      && <OrgDashboard />}
      </div>
    </div>
  );
}
