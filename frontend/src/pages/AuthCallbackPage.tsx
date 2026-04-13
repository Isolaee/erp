import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/shared/Spinner';

export function AuthCallbackPage() {
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const params = new URLSearchParams(window.location.search);
    const token = params.get('accessToken');
    const error = params.get('error');

    // Remove token from browser history immediately
    window.history.replaceState({}, '', '/auth/callback');

    if (error) {
      navigate(`/login?error=${encodeURIComponent(error)}`, { replace: true });
      return;
    }
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }

    loginWithToken(token)
      .then(() => navigate('/dashboard', { replace: true }))
      .catch(() => navigate('/login?error=oauth_failed', { replace: true }));
  }, [loginWithToken, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center space-y-3">
        <Spinner />
        <p className="text-sm text-gray-500">Completing sign-in...</p>
      </div>
    </div>
  );
}
