import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Upload, Search } from 'lucide-react';
import { DocCard } from '../components/docs/DocCard';
import { CreateDocModal } from '../components/docs/CreateDocModal';
import { ImportDocModal } from '../components/docs/ImportDocModal';
import { Spinner } from '../components/shared/Spinner';
import { EmptyState } from '../components/shared/EmptyState';
import { useDebounce } from '../hooks/useDebounce';
import api from '../lib/api';
import type { DocSummary } from '../types/api';

interface DocsResponse {
  docs: DocSummary[];
  page: number;
  q?: string;
}

export function DocsListPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [query,      setQuery]      = useState('');
  const debouncedQ   = useDebounce(query, 300);

  const isSearching  = debouncedQ.trim().length >= 2;

  const { data, isLoading } = useQuery<DocsResponse>({
    queryKey: isSearching ? ['docs', 'search', debouncedQ] : ['docs'],
    queryFn:  () => api.get('/docs', {
      params: isSearching ? { q: debouncedQ } : {},
    }).then((r) => r.data),
  });

  const docs = data?.docs ?? [];

  // Group by visibility when not searching
  const groups = isSearching
    ? [{ label: `Results for "${debouncedQ}"`, docs }]
    : [
        { label: 'Organization', docs: docs.filter((d) => d.visibility === 'ORGANIZATION') },
        { label: 'Team',         docs: docs.filter((d) => d.visibility === 'TEAM') },
        { label: 'Private',      docs: docs.filter((d) => d.visibility === 'PRIVATE') },
      ].filter((g) => g.docs.length > 0);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex-1">Documentation</h1>

        {/* Search */}
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search docs..."
            className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <Upload className="h-4 w-4" />
          Import .md
        </button>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          New Doc
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : docs.length === 0 ? (
        <EmptyState
          title="No documentation yet"
          description={isSearching ? 'No docs matched your search.' : 'Create your first doc or import a markdown file.'}
          action={
            !isSearching ? (
              <button
                onClick={() => setCreateOpen(true)}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                New Doc
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.label}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                {group.label}
              </h2>
              <div className="space-y-2">
                {group.docs.map((doc) => <DocCard key={doc.id} doc={doc} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      <CreateDocModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <ImportDocModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
