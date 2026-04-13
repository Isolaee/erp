import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { setAccessToken } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/shared/Spinner';

interface InvitePreview {
  email?: string;
  role: string;
  teamName?: string;
  senderName: string;
  expiresAt: string;
}

export function RegisterPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.get<InvitePreview>(`/invites/${token}/preview`)
      .then((r) => setPreview(r.data))
      .catch(() => setPreviewError('Invite link is invalid or has expired.'));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<{ accessToken: string }>('/auth/register', { token, name, password });
      setAccessToken(res.data.accessToken);
      await refresh();
      navigate('/dashboard');
    } catch {
      setError('Registration failed. The invite may have already been used.');
    } finally {
      setLoading(false);
    }
  };

  if (previewError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-sm border border-red-200 p-8 max-w-sm w-full text-center">
          <p className="text-red-600 font-medium">{previewError}</p>
        </div>
      </div>
    );
  }

  if (!preview) {
    return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h1 className="text-2xl font-bold text-center text-blue-600 mb-1">Join Coding ERP</h1>
          <p className="text-sm text-center text-gray-500 mb-1">
            Invited by <strong>{preview.senderName}</strong>
          </p>
          {preview.teamName && (
            <p className="text-sm text-center text-gray-500 mb-4">Team: <strong>{preview.teamName}</strong></p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Your name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required autoFocus
              />
            </div>
            {preview.email && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input value={preview.email} disabled className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500" />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
