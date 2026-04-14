import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SSEProvider } from './context/SSEContext';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';

import { LoginPage }         from './pages/LoginPage';
import { RegisterPage }      from './pages/RegisterPage';
import { AuthCallbackPage }  from './pages/AuthCallbackPage';
import { DashboardPage }   from './pages/DashboardPage';
import { TeamsListPage }   from './pages/TeamsListPage';
import { TeamDetailPage }  from './pages/TeamDetailPage';
import { AllListsPage }    from './pages/AllListsPage';
import { ListDetailPage }  from './pages/ListDetailPage';
import { TaskDetailPage }  from './pages/TaskDetailPage';
import { AdminPage }       from './pages/AdminPage';
import { ProfilePage }     from './pages/ProfilePage';
import { DocsListPage }    from './pages/DocsListPage';
import { DocDetailPage }   from './pages/DocDetailPage';

function AppRoutes() {
  const { user } = useAuth();

  return (
    <SSEProvider enabled={!!user}>
      <Routes>
        <Route path="/login"           element={<LoginPage />} />
        <Route path="/auth/callback"   element={<AuthCallbackPage />} />
        <Route path="/register/:token" element={<RegisterPage />} />

        <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/teams"     element={<TeamsListPage />} />
          <Route path="/teams/:id" element={<TeamDetailPage />} />
          <Route path="/lists"     element={<AllListsPage />} />
          <Route path="/lists/:id" element={<ListDetailPage />} />
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
          <Route path="/docs"      element={<DocsListPage />} />
          <Route path="/docs/:id"  element={<DocDetailPage />} />
          <Route path="/admin"     element={<AdminPage />} />
          <Route path="/profile"   element={<ProfilePage />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </SSEProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
