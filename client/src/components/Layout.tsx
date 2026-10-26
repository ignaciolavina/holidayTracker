import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Bell, CalendarDays, Home, LogOut, Menu, Moon, Settings2, ShieldCheck, Sun, User, Users, X, Plane } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown';
import { NotificationBell } from './NotificationBell';
import { TooltipProvider } from '@/components/ui/tooltip';

const NAV: Array<{ to: string; label: string; icon: typeof Home; end?: boolean; id: string }> = [
  { to: '/', label: 'Inicio', icon: Home, end: true, id: 'home' },
  { to: '/requests/new', label: 'Solicitar', icon: Plane, id: 'request' },
  { to: '/calendar', label: 'Mi calendario', icon: CalendarDays, id: 'calendar' },
  { to: '/team', label: 'Equipo', icon: Users, id: 'team' },
  { to: '/notifications', label: 'Notificaciones', icon: Bell, id: 'notifications' },
  { to: '/profile', label: 'Perfil', icon: Settings2, id: 'profile' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (!user) return null;

  const links = (
    <nav aria-label="Principal" className="flex flex-col gap-1 p-3">
      {NAV.map(({ to, label, icon: Icon, end, id }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          data-testid={`nav-${id}`}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent', isActive && 'bg-accent text-accent-foreground')
          }
        >
          <Icon className="h-4 w-4" aria-hidden /> {label}
        </NavLink>
      ))}
      {user.role === 'admin' && (
        <NavLink
          to="/admin"
          data-testid="nav-admin"
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent', isActive && 'bg-accent text-accent-foreground')
          }
        >
          <ShieldCheck className="h-4 w-4" aria-hidden /> Administración
        </NavLink>
      )}
    </nav>
  );

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-screen md:grid md:grid-cols-[14rem_1fr]">
        <aside className="hidden border-r bg-card md:block">
          <Link to="/" className="flex h-14 items-center gap-2 px-5 text-lg font-bold">
            <CalendarDays className="h-5 w-5 text-primary" aria-hidden /> holidayTracker
          </Link>
          {links}
        </aside>
        {open && (
          <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menú">
            <button aria-label="Cerrar menú" className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
            <div className="relative h-full w-64 bg-card shadow-lg">
              <div className="flex h-14 items-center justify-between px-4">
                <span className="font-bold">holidayTracker</span>
                <Button variant="ghost" size="icon" aria-label="Cerrar" onClick={() => setOpen(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
              {links}
            </div>
          </div>
        )}
        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-5">
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menú" data-testid="menu-toggle" onClick={() => setOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <div className="flex-1" />
            <NotificationBell />
            <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} data-testid="theme-toggle">
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2" data-testid="user-menu" aria-label="Menú de usuario">
                  <Avatar name={user.name} url={user.avatarUrl} />
                  <span className="hidden max-w-[10rem] truncate text-sm sm:inline">{user.name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/profile')}>
                  <User className="h-4 w-4" /> Mi perfil
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="logout"
                  onSelect={async () => {
                    await logout();
                    navigate('/login');
                  }}
                >
                  <LogOut className="h-4 w-4" /> Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 p-3 sm:p-5">
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
