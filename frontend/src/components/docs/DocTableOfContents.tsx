import { clsx } from 'clsx';
import type { DocSection } from '../../types/api';

interface Props {
  sections: DocSection[];
  activeOrder?: number;
}

export function DocTableOfContents({ sections, activeOrder }: Props) {
  if (sections.length < 2) return null;

  return (
    <nav className="sticky top-4 rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
        Contents
      </p>
      <ul className="space-y-0.5">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#section-${s.order}`}
              className={clsx(
                'block truncate rounded px-2 py-1 text-sm transition-colors',
                s.level === 1 ? 'pl-2'  :
                s.level === 2 ? 'pl-4'  : 'pl-6',
                activeOrder === s.order
                  ? 'bg-blue-50 font-medium text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
              )}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(`section-${s.order}`)?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              {s.heading}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
