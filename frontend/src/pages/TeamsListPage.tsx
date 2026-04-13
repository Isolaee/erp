import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users, Plus } from 'lucide-react';
import type { Team } from '../types/api';
import { Spinner } from '../components/shared/Spinner';
import { EmptyState } from '../components/shared/EmptyState';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';

export function TeamsListPage() {
  const { user } = useAuth();

  const { data: teams, isLoading } = useQuery<Team[]>({
    queryKey: ['teams'],
    queryFn: () => api.get('/teams').then((r) => r.data),
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Teams</h1>
        {user?.role === 'ADMIN' && (
          <Link
            to="/admin"
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> New Team
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (teams?.length ?? 0) === 0 ? (
        <EmptyState title="No teams yet" description={user?.role === 'ADMIN' ? 'Create your first team in Admin.' : 'You have not been added to any teams yet.'} />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {teams!.map((team) => (
            <Link
              key={team.id}
              to={`/teams/${team.id}`}
              className="rounded-xl border border-gray-200 bg-white p-5 hover:border-blue-300 transition-colors"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Users className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{team.name}</p>
                  <p className="text-xs text-gray-500">{team._count?.members ?? 0} members</p>
                </div>
              </div>
              {team.description && <p className="text-sm text-gray-500 truncate">{team.description}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
