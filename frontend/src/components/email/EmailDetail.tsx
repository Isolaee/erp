import { useEffect, useState } from "react";
import { getEmail, updateLabels, replyToEmail, type EmailDetail as TEmailDetail } from "../../lib/emailApi";
import { format } from "date-fns";

interface Props {
  emailId: number;
  onClose: () => void;
  onLabelsChanged?: () => void;
}

function displayLabel(l: string): string {
  if (l.startsWith("CATEGORY_")) return l.slice(9);
  if (l.startsWith("\\")) return l.slice(1);
  return l;
}

export default function EmailDetail({ emailId, onClose, onLabelsChanged }: Props) {
  const [email, setEmail] = useState<TEmailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [labels, setLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [addingLabel, setAddingLabel] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replyStatus, setReplyStatus] = useState<"idle" | "ok" | "error">("idle");

  useEffect(() => {
    setLoading(true);
    getEmail(emailId).then((e) => {
      setEmail(e);
      setLabels(e.labels);
      setLoading(false);
    });
  }, [emailId]);

  async function handleRemoveLabel(label: string) {
    const prev = labels;
    setLabels(labels.filter(l => l !== label));
    try {
      await updateLabels(emailId, [], [label]);
      onLabelsChanged?.();
    } catch {
      setLabels(prev);
    }
  }

  async function handleAddLabel() {
    const trimmed = newLabel.trim();
    if (!trimmed || labels.includes(trimmed)) {
      setNewLabel("");
      setAddingLabel(false);
      return;
    }
    const prev = labels;
    setLabels([...labels, trimmed]);
    setNewLabel("");
    setAddingLabel(false);
    try {
      await updateLabels(emailId, [trimmed], []);
      onLabelsChanged?.();
    } catch {
      setLabels(prev);
    }
  }

  async function handleSendReply() {
    if (!replyBody.trim() || !email) return;
    setReplySending(true);
    setReplyStatus("idle");
    try {
      await replyToEmail(email.id, replyBody);
      setReplyStatus("ok");
      setReplyBody("");
      setReplyOpen(false);
    } catch {
      setReplyStatus("error");
    } finally {
      setReplySending(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center h-full text-gray-600 text-sm">Loading…</div>;
  if (!email) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-900/50">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-100 mb-1">{email.subject || "(no subject)"}</h2>
            <div className="text-xs text-gray-400 space-y-0.5">
              <div><span className="text-gray-600">From:</span> {email.sender}</div>
              <div><span className="text-gray-600">To:</span> {email.recipients.join(", ")}</div>
              <div>
                <span className="text-gray-600">Date:</span>{" "}
                {email.date ? format(new Date(email.date), "PPpp") : "unknown"}
              </div>
              <div>
                <span className="text-gray-600">Account:</span>{" "}
                <span className="text-blue-400">{email.account_email}</span>
              </div>
            </div>

            {/* Label chips */}
            <div className="flex flex-wrap items-center gap-1 mt-2">
              {labels.map(l => (
                <span
                  key={l}
                  className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700"
                >
                  {displayLabel(l)}
                  <button
                    onClick={() => handleRemoveLabel(l)}
                    className="ml-0.5 text-gray-600 hover:text-gray-300 leading-none"
                    title={`Remove ${l}`}
                  >
                    ×
                  </button>
                </span>
              ))}

              {addingLabel ? (
                <form
                  onSubmit={e => { e.preventDefault(); handleAddLabel(); }}
                  className="flex items-center gap-1"
                >
                  <input
                    autoFocus
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    onBlur={handleAddLabel}
                    onKeyDown={e => e.key === "Escape" && (setAddingLabel(false), setNewLabel(""))}
                    placeholder="label name"
                    className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 border border-blue-600 text-gray-200 outline-none w-24"
                  />
                </form>
              ) : (
                <button
                  onClick={() => setAddingLabel(true)}
                  className="text-[10px] px-1.5 py-0.5 rounded-full border border-dashed border-gray-700 text-gray-600 hover:border-gray-500 hover:text-gray-400"
                  title="Add label"
                >
                  + label
                </button>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 text-lg shrink-0">✕</button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
          {email.body_text || "(empty)"}
        </pre>
      </div>

      {/* Reply composer */}
      <div className="border-t border-gray-800 px-6 py-3 shrink-0">
        {replyStatus === "ok" && (
          <p className="text-xs text-green-400 mb-2">Reply sent.</p>
        )}
        {replyStatus === "error" && (
          <p className="text-xs text-red-400 mb-2">Failed to send. Try again.</p>
        )}
        {replyOpen ? (
          <div className="space-y-2">
            <div className="text-xs text-gray-500">
              To: <span className="text-gray-300">{email.sender}</span>
              {" · "}Re: {email.subject}
            </div>
            <textarea
              autoFocus
              value={replyBody}
              onChange={e => setReplyBody(e.target.value)}
              placeholder="Write your reply…"
              rows={5}
              className="w-full bg-gray-800 text-gray-100 text-sm px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSendReply}
                disabled={replySending || !replyBody.trim()}
                className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg transition-colors"
              >
                {replySending ? "Sending…" : "Send"}
              </button>
              <button
                onClick={() => { setReplyOpen(false); setReplyBody(""); setReplyStatus("idle"); }}
                className="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setReplyOpen(true); setReplyStatus("idle"); }}
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            ↩ Reply
          </button>
        )}
      </div>
    </div>
  );
}
