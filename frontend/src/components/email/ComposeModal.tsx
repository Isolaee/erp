import { useEffect, useState } from "react";
import { listAccounts, sendEmail, type Account } from "../../lib/emailApi";

interface Props {
  onClose: () => void;
}

export default function ComposeModal({ onClose }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    listAccounts().then(ac => {
      setAccounts(ac);
      if (ac.length > 0) setAccountId(ac[0].id);
    });
  }, []);

  async function handleSend() {
    if (!accountId || !to.trim() || !subject.trim() || !body.trim()) return;
    setSending(true);
    setStatus("idle");
    try {
      await sendEmail(accountId, to.trim(), subject.trim(), body);
      setStatus("ok");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  const dirty = to.trim() || subject.trim() || body.trim();

  function handleClose() {
    if (dirty && status !== "ok") {
      if (!confirm("Discard unsent email?")) return;
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && handleClose()}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-xl w-full max-w-lg mx-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-200">New Email</h2>
          <button onClick={handleClose} className="text-gray-600 hover:text-gray-300 text-lg">✕</button>
        </div>

        {/* Fields */}
        <div className="px-5 py-4 space-y-3">
          {/* From account */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-500 w-14 shrink-0">From</label>
            <select
              value={accountId ?? ""}
              onChange={e => setAccountId(Number(e.target.value))}
              className="flex-1 bg-gray-800 text-gray-200 text-sm px-3 py-1.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
            >
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.email}</option>
              ))}
            </select>
          </div>

          {/* To */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-500 w-14 shrink-0">To</label>
            <input
              autoFocus
              type="email"
              value={to}
              onChange={e => setTo(e.target.value)}
              placeholder="recipient@example.com"
              className="flex-1 bg-gray-800 text-gray-100 text-sm px-3 py-1.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
            />
          </div>

          {/* Subject */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-500 w-14 shrink-0">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Subject"
              className="flex-1 bg-gray-800 text-gray-100 text-sm px-3 py-1.5 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
            />
          </div>

          {/* Body */}
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write your message…"
            rows={8}
            className="w-full bg-gray-800 text-gray-100 text-sm px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 resize-none"
          />

          {/* Status */}
          {status === "ok" && <p className="text-xs text-green-400">Email sent!</p>}
          {status === "error" && <p className="text-xs text-red-400">Failed: {errorMsg}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-800">
          <button
            onClick={handleClose}
            className="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !accountId || !to.trim() || !subject.trim() || !body.trim()}
            className="px-5 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg transition-colors"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
