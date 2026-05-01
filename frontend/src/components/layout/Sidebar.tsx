import { NavLink } from 'react-router-dom';
import { clsx } from 'clsx';
import { LayoutDashboard, Users, ListTodo, Settings, Shield, BookOpen, Inbox, CalendarDays, Mail } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const navItems = [
  { to: '/dashboard',      label: 'Dashboard', icon: LayoutDashboard },
  { to: '/teams',          label: 'Teams',     icon: Users },
  { to: '/lists',          label: 'Lists',     icon: ListTodo },
  { to: '/docs',           label: 'Docs',      icon: BookOpen },
  { to: '/inbox',          label: 'Inbox',     icon: Inbox },
  { to: '/email-calendar', label: 'Calendar',  icon: CalendarDays },
  { to: '/email-settings', label: 'Email Accts', icon: Mail },
  { to: '/profile',        label: 'Profile',   icon: Settings },
];

export function Sidebar() {
  const { user } = useAuth();

  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <span className="text-lg font-bold text-blue-600">Coding ERP</span>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => clsx(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
        {(user?.role === 'ADMIN') && (
          <NavLink
            to="/admin"
            className={({ isActive }) => clsx(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
            )}
          >
            <Shield className="h-4 w-4" />
            Admin
          </NavLink>
        )}
      </nav>
    </aside>
  );
}
