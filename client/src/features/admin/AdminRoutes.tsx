import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { cn } from '@/lib/utils';
import { AdminDashboard } from './AdminDashboard';
import { BalancesPage } from './BalancesPage';
import { UsersPage } from './UsersPage';
import { OrgPage } from './OrgPage';
import { HolidaysPage } from './HolidaysPage';
import { SettingsPage } from './SettingsPage';
import { AuditPage } from './AuditPage';
import { JobsPage } from './JobsPage';
import { RetroactivePage } from './RetroactivePage';

const SECTIONS = [
  { to: '', label: 'Resumen', end: true, id: 'overview' },
  { to: 'balances', label: 'Saldos', id: 'balances' },
  { to: 'users', label: 'Usuarios', id: 'users' },
  { to: 'org', label: 'Organigrama', id: 'org' },
  { to: 'holidays', label: 'Festivos', id: 'holidays' },
  { to: 'retroactive', label: 'Registro retroactivo', id: 'retroactive' },
  { to: 'settings', label: 'Configuración', id: 'settings' },
  { to: 'audit', label: 'Auditoría', id: 'audit' },
  { to: 'jobs', label: 'Procesos', id: 'jobs' },
] as const;

/** Panel de administración (SPEC-18), montado en /admin/*. Solo role admin (lo garantiza App.tsx). */
export default function AdminRoutes() {
  return (
    <div data-testid="admin-root">
      <PageHeader title="Administración" />
      <nav aria-label="Secciones de administración" className="-mx-1 mb-5 flex gap-1 overflow-x-auto px-1 pb-1" data-testid="admin-nav">
        {SECTIONS.map((s) => (
          <NavLink
            key={s.id}
            to={s.to}
            end={'end' in s ? s.end : false}
            data-testid={`admin-nav-${s.id}`}
            className={({ isActive }) =>
              cn('whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors', isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground')
            }
          >
            {s.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<AdminDashboard />} />
        <Route path="balances" element={<BalancesPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="org" element={<OrgPage />} />
        <Route path="holidays" element={<HolidaysPage />} />
        <Route path="retroactive" element={<RetroactivePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </div>
  );
}
