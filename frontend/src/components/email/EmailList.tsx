import { useEffect, useState, useCallback, useMemo } from "react";
import { listEmails, listAccounts, type EmailSummary, type Account } from "../../lib/emailApi";
import { formatDistanceToNow } from "date-fns";

interface Props {
  selectedId: number | null;
  onSelect: (id: number) => void;
  refreshKey?: number;
  labelFilter?: string | null;
  onLabelFilterChange?: (label: string | null) => void;
  onCompose?: () => void;
}

const PROVIDER_COLORS: Record<string, string> = {
  gmail: "bg-red-600",
  outlook: "bg-blue-600",
  imap: "bg-green-600",
};

// Strip noisy prefixes for display
function displayLabel(l: string): string {
  if (l.startsWith("CATEGORY_")) return l.slice(9);
  if (l.startsWith("\\")) return l.slice(1);
  return l;
}

// Labels that are already surfaced through dedicated UI (read/starred/account filter)
const HIDDEN_LABELS = new Set(["INBOX", "UNREAD", "STARRED", "\\Seen", "\\Recent", "\\Answered", "\\Deleted"]);

type SortField = "date" | "sender" | "subject";

export default function EmailList({ selectedId, onSelect, refreshKey, labelFilter, onLabelFilterChange, onCompose }: Props) {
  const [emails, setEmails] = useState<EmailSummary[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<number | undefined>();
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [em, ac] = await Promise.all([
        listEmails({ account_id: selectedAccount, search: search || undefined, unread_only: unreadOnly, limit: 100 }),
        listAccounts(),
      ]);
      setEmails(em);
      setAccounts(ac);
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, search, unreadOnly]);

  useEffect(() => { load(); }, [load, refreshKey]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [search, load]);

  const allLabels = useMemo(() => {
    const set = new Set<string>();
    for (const e of emails) {
      for (const l of e.labels) {
        if (!HIDDEN_LABELS.has(l)) set.add(l);
      }
    }
    return [...set].sort();
  }, [emails]);

  const displayedEmails = useMemo(() => {
    let result = labelFilter ? emails.filter(e => e.labels.includes(labelFilter)) : [...emails];
    result.sort((a, b) => {
      let av = "", bv = "";
      if (sortBy === "date") { av = a.date ?? ""; bv = b.date ?? ""; }
      else if (sortBy === "sender") { av = a.sender.toLowerCase(); bv = b.sender.toLowerCase(); }
      else { av = a.subject.toLowerCase(); bv = b.subject.toLowerCase(); }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "desc" ? -cmp : cmp;
    });
    return result;
  }, [emails, labelFilter, sortBy, sortDir]);

  function toggleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortBy(field);
      setSortDir(field === "date" ? "desc" : "asc");
    }
  }

  return (
    <div className="w-80 border-r border-gray-800 flex flex-col shrink-0 bg-gray-950">
      {/* Filters */}
      <div className="p-3 border-b border-gray-800 space-y-2">
        <input
          type="text"
          placeholder="Search emails..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-gray-800 text-gray-100 text-sm px-3 py-1.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
        />
        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={selectedAccount ?? ""}
            onChange={(e) => setSelectedAccount(e.target.value ? Number(e.target.value) : undefined)}
            className="flex-1 bg-gray-800 text-gray-300 text-xs px-2 py-1 rounded-lg outline-none"
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.email}</option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
            Unread
          </label>
          <button onClick={load} className="text-xs text-gray-500 hover:text-gray-300" title="Refresh">↻</button>
          {onCompose && (
            <button onClick={onCompose} className="text-xs text-gray-500 hover:text-gray-300" title="Compose">✏</button>
          )}
        </div>

        {/* Sort controls */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-600 mr-1">Sort:</span>
          {(["date", "sender", "subject"] as SortField[]).map(f => (
            <button
              key={f}
              onClick={() => toggleSort(f)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                sortBy === f
                  ? "bg-blue-700 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {f}{sortBy === f ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
            </button>
          ))}
        </div>

        {/* Label filter chips */}
        {allLabels.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {allLabels.map(l => (
              <button
                key={l}
                onClick={() => onLabelFilterChange?.(labelFilter === l ? null : l)}
                className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
                  labelFilter === l
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300"
                }`}
              >
                {displayLabel(l)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="text-center text-gray-600 text-xs py-8">Loading…</div>}
        {!loading && displayedEmails.length === 0 && (
          <div className="text-center text-gray-600 text-xs py-8">No emails</div>
        )}
        {displayedEmails.map((email) => (
          <button
            key={email.id}
            onClick={() => onSelect(email.id)}
            className={`w-full text-left px-3 py-2.5 border-b border-gray-800/50 hover:bg-gray-800/50 transition-colors ${
              selectedId === email.id ? "bg-gray-800" : ""
            }`}
          >
            <div className="flex items-start gap-2">
              <span
                className={`mt-0.5 shrink-0 w-1.5 h-1.5 rounded-full ${email.is_read ? "bg-transparent" : "bg-blue-400"}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 mb-0.5">
                  <span className={`text-[9px] px-1 rounded text-white uppercase font-bold ${PROVIDER_COLORS[email.provider] ?? "bg-gray-600"}`}>
                    {email.provider[0]}
                  </span>
                  <span className="text-xs text-gray-400 truncate flex-1">{email.sender.split("<")[0].trim() || email.sender}</span>
                  <span className="text-[10px] text-gray-600 shrink-0">
                    {email.date ? formatDistanceToNow(new Date(email.date), { addSuffix: false }) : ""}
                  </span>
                </div>
                <div className={`text-xs truncate ${email.is_read ? "text-gray-400" : "text-gray-100 font-medium"}`}>
                  {email.subject || "(no subject)"}
                </div>
                <div className="text-[10px] text-gray-600 truncate mt-0.5">{email.snippet}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
