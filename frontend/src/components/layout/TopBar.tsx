import { Bell, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSSE } from '../../context/SSEContext';
import { useNavigate } from 'react-router-dom';

export function TopBar() {
  const { user, logout } = useAuth();
  const { notificationCount, clearNotifications } = useSSE();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <div />
      <div className="flex items-center gap-4">
        <button
          onClick={clearNotifications}
          className="relative p-1.5 text-gray-500 hover:text-gray-700"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {notificationCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white font-bold">
              {notificationCount > 9 ? '9+' : notificationCount}
            </span>
          )}
        </button>
        <span className="text-sm text-gray-600">{user?.name}</span>
        <button onClick={handleLogout} className="text-gray-500 hover:text-gray-700" aria-label="Logout">
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
