import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Layout } from '@/components/Layout';
import { Loading } from '@/components/PageHeader';
import LoginPage from '@/features/auth/LoginPage';
import ForgotPage from '@/features/auth/ForgotPage';
import ResetPage from '@/features/auth/ResetPage';
import InvitePage from '@/features/auth/InvitePage';
import DashboardPage from '@/features/dashboard/DashboardPage';
import RequestPage from '@/features/requests/RequestPage';
import CalendarPage from '@/features/calendar/CalendarPage';
import TeamPage from '@/features/team/TeamPage';
import ProfilePage from '@/features/profile/ProfilePage';
import NotificationsPage from '@/features/notifications/NotificationsPage';

const AdminRoutes = lazy(() => import('@/features/admin/AdminRoutes'));
const ApprovalPage = lazy(() => import('@/features/admin/ApprovalPage'));

function RequireAuth({ admin = false }: { admin?: boolean }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading label="Cargando…" />;
  if (!user) return <Navigate to={`/login?from=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return <Layout />;
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot" element={<ForgotPage />} />
          <Route path="/reset" element={<ResetPage />} />
          <Route path="/invite" element={<InvitePage />} />
          <Route element={<RequireAuth />}>
            <Route index element={<DashboardPage />} />
            <Route path="requests/new" element={<RequestPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="calendar/:userId" element={<CalendarPage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="notifications" element={<NotificationsPage />} />
          </Route>
          <Route element={<RequireAuth admin />}>
            <Route path="admin/*" element={<AdminRoutes />} />
            <Route path="approvals/:id" element={<ApprovalPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
