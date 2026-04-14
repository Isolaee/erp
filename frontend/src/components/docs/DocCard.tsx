import { Link } from 'react-router-dom';
import { FileText, GitBranch, Clock } from 'lucide-react';
import { clsx } from 'clsx';
import type { DocSummary } from '../../types/api';

interface Props {
  doc: DocSummary;
}

const visibilityColors: Record<string, string> = {
  PRIVATE:      'bg-gray-100 text-gray-600',
  TEAM:         'bg-blue-50 text-blue-700',
  ORGANIZATION: 'bg-green-50 text-green-700',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function DocCard({ doc }: Props) {
  return (
    <Link
      to={`/docs/${doc.id}`}
      className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 shrink-0 text-gray-400" />
          <span className="font-medium text-gray-900 truncate">{doc.title}</span>
        </div>
        <span className={clsx('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', visibilityColors[doc.visibility])}>
          {doc.visibility.charAt(0) + doc.visibility.slice(1).toLowerCase()}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
        {doc.team && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">
            {doc.team.name}
          </span>
        )}
        {doc.repoFollow && (
          <span className="flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            {doc.repoFollow.owner}/{doc.repoFollow.repo}
          </span>
        )}
        <span className="flex items-center gap-1 ml-auto">
          <Clock className="h-3 w-3" />
          {timeAgo(doc.updatedAt)}
        </span>
        {doc.owner && <span>{doc.owner.name}</span>}
      </div>
    </Link>
  );
}
