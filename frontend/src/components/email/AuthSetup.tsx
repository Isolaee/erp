import { useEffect, useState } from "react";
import { authStatus, getGoogleAuthUrl, getMicrosoftAuthUrl, type AuthStatus } from "../../lib/emailApi";

export default function AuthSetup() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try { setStatus(await authStatus()); } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const connectGoogle = async () => {
    const { url } = await getGoogleAuthUrl();
    window.location.href = url;
  };

  const connectMicrosoft = async (account: string) => {
    const { url } = await getMicrosoftAuthUrl(account);
    window.location.href = url;
  };

  if (loading) return <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">Loading…</div>;

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <h1 className="text-lg font-semibold text-gray-100 mb-6">Account Setup</h1>

      <div className="max-w-lg space-y-4">
        {/* Google */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Google (Gmail + Calendar)</div>
              <div className="text-xs text-gray-500 mt-0.5">Reads Gmail, manages Google Calendar</div>
            </div>
            {status?.google ? (
              <span className="text-xs text-green-400 bg-green-900/30 px-2 py-1 rounded-lg">Connected</span>
            ) : (
              <button
                onClick={connectGoogle}
                className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg"
              >
                Connect
              </button>
            )}
          </div>
        </div>

        {/* Microsoft accounts */}
        {Object.entries(status?.microsoft ?? {}).length === 0 ? (
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="text-sm font-medium mb-2">Outlook Accounts</div>
            <p className="text-xs text-gray-500">
              Add your Outlook email addresses to <code className="bg-gray-800 px-1 rounded">OUTLOOK_ACCOUNTS</code> in your <code className="bg-gray-800 px-1 rounded">.env</code> file, then restart the server.
            </p>
          </div>
        ) : (
          Object.entries(status!.microsoft).map(([acc, connected]) => (
            <div key={acc} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Outlook: {acc}</div>
                </div>
                {connected ? (
                  <span className="text-xs text-green-400 bg-green-900/30 px-2 py-1 rounded-lg">Connected</span>
                ) : (
                  <button
                    onClick={() => connectMicrosoft(acc)}
                    className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg"
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>
          ))
        )}

        {/* IMAP */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-sm font-medium mb-2">IMAP (Roundcube)</div>
          <p className="text-xs text-gray-500">
            Configure <code className="bg-gray-800 px-1 rounded">IMAP_HOST</code>, <code className="bg-gray-800 px-1 rounded">IMAP_USERNAME</code>, and <code className="bg-gray-800 px-1 rounded">IMAP_PASSWORD</code> in your <code className="bg-gray-800 px-1 rounded">.env</code> file. Syncs automatically.
          </p>
        </div>

        <button
          onClick={load}
          className="text-xs text-gray-500 hover:text-gray-300 mt-2"
        >
          ↻ Refresh status
        </button>
      </div>
    </div>
  );
}
