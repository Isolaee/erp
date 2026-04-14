import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import {
  ArrowLeft, Sparkles, GitBranch, RefreshCw, Eye, Edit3,
} from 'lucide-react';
import { clsx } from 'clsx';
import { DocMarkdownEditor } from '../components/docs/DocMarkdownEditor';
import { DocTableOfContents } from '../components/docs/DocTableOfContents';
import { DocAIPanel } from '../components/docs/DocAIPanel';
import { Spinner } from '../components/shared/Spinner';
import { queryClient } from '../lib/queryClient';
import { getAccessToken } from '../lib/api';
import api from '../lib/api';
import type { Doc, DocSection } from '../types/api';

const visibilityLabel: Record<string, string> = {
  PRIVATE: 'Private', TEAM: 'Team', ORGANIZATION: 'Org',
};
const visibilityColor: Record<string, string> = {
  PRIVATE:      'bg-gray-100 text-gray-600',
  TEAM:         'bg-blue-50 text-blue-700',
  ORGANIZATION: 'bg-green-50 text-green-700',
};

export function DocDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tab,        setTab]        = useState<'edit' | 'preview'>('edit');
  const [aiOpen,     setAiOpen]     = useState(false);
  const [content,    setContent]    = useState('');
  const [title,      setTitle]      = useState('');
  const [editTitle,  setEditTitle]  = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [syncing,    setSyncing]    = useState(false);
  const [activeOrder, setActiveOrder] = useState<number | undefined>();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: doc, isLoading } = useQuery<Doc>({
    queryKey: ['docs', id],
    queryFn:  () => api.get(`/docs/${id}`).then((r) => r.data),
    enabled:  !!id,
  });

  // Sync local state when doc loads
  useEffect(() => {
    if (doc) {
      setContent(doc.content);
      setTitle(doc.title);
    }
  }, [doc?.id]); // only on mount / id change

  // Debounced auto-save
  const scheduleAutoSave = useCallback((newContent: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await api.patch(`/docs/${id}`, { content: newContent });
        queryClient.invalidateQueries({ queryKey: ['docs', id] });
      } finally {
        setSaving(false);
      }
    }, 1500);
  }, [id]);

  const handleContentChange = (val: string) => {
    setContent(val);
    scheduleAutoSave(val);
  };

  const handleTitleBlur = async () => {
    setEditTitle(false);
    if (!title.trim() || title === doc?.title) return;
    await api.patch(`/docs/${id}`, { title: title.trim() });
    queryClient.invalidateQueries({ queryKey: ['docs', id] });
    queryClient.invalidateQueries({ queryKey: ['docs'] });
  };

  // Trigger-sync (on-demand repo check): streams SSE back
  const handleTriggerSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const token = getAccessToken();
      const base  = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
      const response = await fetch(`${base}/api/docs/${id}/trigger-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      // If SSE stream (repo had changes), drain it
      if (response.headers.get('content-type')?.includes('text/event-stream') && response.body) {
        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          if (text.includes('"done"') || text.includes('"error"')) break;
        }
        queryClient.invalidateQueries({ queryKey: ['docs', id] });
        queryClient.invalidateQueries({ queryKey: ['docs'] });
      }
    } finally {
      setSyncing(false);
    }
  };

  // IntersectionObserver for active TOC heading
  useEffect(() => {
    if (!doc?.sections?.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const order = parseInt(entry.target.getAttribute('data-order') ?? '', 10);
            if (!isNaN(order)) setActiveOrder(order);
          }
        }
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    const els = document.querySelectorAll('[data-section-heading]');
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [doc?.sections, tab]);

  if (isLoading) return <div className="flex justify-center p-12"><Spinner /></div>;
  if (!doc) return <div className="p-6 text-gray-500">Doc not found.</div>;

  const sections: DocSection[] = doc.sections ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 bg-white">
        <Link to="/docs" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </Link>

        {editTitle ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') handleTitleBlur(); }}
            className="text-xl font-bold text-gray-900 border-b-2 border-blue-500 focus:outline-none bg-transparent flex-1"
          />
        ) : (
          <h1
            className="text-xl font-bold text-gray-900 flex-1 cursor-pointer hover:text-blue-700"
            onClick={() => setEditTitle(true)}
          >
            {doc.title}
          </h1>
        )}

        {/* Badges */}
        <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', visibilityColor[doc.visibility])}>
          {visibilityLabel[doc.visibility]}
        </span>
        {doc.repoFollow && (
          <span className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            <GitBranch className="h-3 w-3" />
            {doc.repoFollow.owner}/{doc.repoFollow.repo}
          </span>
        )}

        {/* Saving indicator */}
        {saving && <span className="text-xs text-gray-400 flex items-center gap-1"><Spinner className="h-3 w-3" /> Saving…</span>}

        {/* Repo sync button */}
        {doc.repoFollowId && (
          <button
            onClick={handleTriggerSync}
            disabled={syncing}
            title="Check for new repo activity and update doc"
            className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={clsx('h-3.5 w-3.5', syncing && 'animate-spin')} />
            {syncing ? 'Syncing…' : 'Check repo'}
          </button>
        )}

        <button
          onClick={() => setAiOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          <Sparkles className="h-4 w-4" />
          AI
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-6 pt-3 pb-0 border-b border-gray-200 bg-white">
        <button
          onClick={() => setTab('edit')}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'edit'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700',
          )}
        >
          <Edit3 className="h-3.5 w-3.5" /> Edit
        </button>
        <button
          onClick={() => setTab('preview')}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'preview'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700',
          )}
        >
          <Eye className="h-3.5 w-3.5" /> Preview
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'edit' ? (
            <DocMarkdownEditor
              value={content}
              onChange={handleContentChange}
              className="min-h-[calc(100vh-220px)]"
            />
          ) : (
            <div className="prose prose-sm max-w-none">
              {sections.map((s) => (
                <span
                  key={s.id}
                  id={`section-${s.order}`}
                  data-order={s.order}
                  data-section-heading
                />
              ))}
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* TOC sidebar */}
        {sections.length >= 2 && (
          <div className="w-56 shrink-0 overflow-y-auto p-4 hidden lg:block">
            <DocTableOfContents sections={sections} activeOrder={activeOrder} />
          </div>
        )}
      </div>

      <DocAIPanel open={aiOpen} onClose={() => setAiOpen(false)} docId={doc.id} />
    </div>
  );
}
