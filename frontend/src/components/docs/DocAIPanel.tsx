import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Spinner } from '../shared/Spinner';
import { getAccessToken } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';

interface ToolCallEvent {
  tool: string;
  input: Record<string, unknown>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  docId: string;
}

export function DocAIPanel({ open, onClose, docId }: Props) {
  const [prompt,    setPrompt]    = useState('');
  const [streaming, setStreaming] = useState(false);
  const [text,      setText]      = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCallEvent[]>([]);

  const handleRefine = async () => {
    if (!prompt.trim() || streaming) return;
    setStreaming(true);
    setText('');
    setToolCalls([]);

    const token = getAccessToken();
    const base  = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

    const response = await fetch(`${base}/api/docs/${docId}/ai-refine`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ prompt: prompt.trim() }),
    });

    if (!response.body) { setStreaming(false); return; }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    const parse = (chunk: string) => {
      const events: Array<{ type: string; data: unknown }> = [];
      const lines = chunk.split('\n');
      let eventType = '';
      let dataStr   = '';
      for (const line of lines) {
        if (line.startsWith('event: '))      { eventType = line.slice(7).trim(); }
        else if (line.startsWith('data: '))  { dataStr   = line.slice(6).trim(); }
        else if (line === '' && eventType) {
          try { events.push({ type: eventType, data: JSON.parse(dataStr) }); } catch { /* skip */ }
          eventType = ''; dataStr = '';
        }
      }
      return events;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          for (const evt of parse(part + '\n\n')) {
            if (evt.type === 'text') {
              setText((t) => t + (evt.data as { text: string }).text);
            } else if (evt.type === 'tool_call') {
              setToolCalls((tc) => [...tc, evt.data as ToolCallEvent]);
            } else if (evt.type === 'done') {
              queryClient.invalidateQueries({ queryKey: ['docs', docId] });
              queryClient.invalidateQueries({ queryKey: ['docs'] });
            }
          }
        }
      }
    } finally {
      setStreaming(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-96 bg-white shadow-xl flex flex-col border-l border-gray-200">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-blue-600" />
          <h2 className="font-semibold text-gray-900">AI Doc Assistant</h2>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {toolCalls.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Actions taken</p>
            {toolCalls.map((tc, i) => (
              <div key={i} className="flex items-center gap-2 rounded bg-blue-50 px-2 py-1 text-xs">
                <span className="font-mono font-medium text-blue-700">{tc.tool}</span>
                {!!tc.input.heading && (
                  <span className="text-gray-600 truncate">"{String(tc.input.heading)}"</span>
                )}
                {!!tc.input.reason && (
                  <span className="text-gray-500 truncate italic">{String(tc.input.reason)}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {text && (
          <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-wrap">
            {text}
            {streaming && <span className="inline-block w-1.5 h-4 ml-0.5 bg-gray-400 animate-pulse" />}
          </div>
        )}

        {!text && !streaming && (
          <p className="text-sm text-gray-400 text-center pt-8">
            Ask AI to improve this doc, add sections, update for recent changes, or rewrite parts.
          </p>
        )}
      </div>

      <div className="p-4 border-t border-gray-200">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="e.g. Add a troubleshooting section, update the setup steps..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleRefine();
          }}
        />
        <button
          onClick={handleRefine}
          disabled={!prompt.trim() || streaming}
          className="mt-2 w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {streaming
            ? <><Spinner className="h-4 w-4" /> Updating doc...</>
            : <><Sparkles className="h-4 w-4" /> Improve with AI</>}
        </button>
        <p className="mt-1 text-center text-xs text-gray-400">Ctrl+Enter to send</p>
      </div>
    </div>
  );
}
