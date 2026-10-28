import type { ReactNode } from 'react';
import { CalendarDays } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function AuthShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="bg-brand-gradient relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div aria-hidden className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-white/5" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 h-[28rem] w-[28rem] rounded-full bg-white/5" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-white">
          <span className="brand-mark h-12 w-12 rounded-xl"><CalendarDays className="h-7 w-7" aria-hidden /></span>
          <div className="text-center leading-tight">
            <div className="text-2xl font-semibold">holidayTracker</div>
            <div className="text-xs font-medium uppercase tracking-[0.22em] text-white/70">Bemycar</div>
          </div>
        </div>
        <Card className="border-0 shadow-2xl shadow-black/30">
          <CardHeader>
            <CardTitle className="text-xl">{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
        <p className="mt-6 text-center text-xs text-white/60">Gestión de vacaciones del equipo Bemycar</p>
      </div>
    </div>
  );
}
