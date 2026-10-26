# Frontend — guía rápida

Stack: React 18 + Vite + Tailwind (variables CSS estilo shadcn) + React Query + React Router. Todo en español.
El front **solo presenta**: nunca calcula días ni saldos (CLAUDE.md regla 5). Las cantidades de la API son **medios días**.

## Estructura
- `lib/api.ts` — `api.get/post/patch/del`, `ApiError {status,code,message}`, `qs()`. Envía `X-Requested-With: holidaytracker`
  siempre, `credentials: 'include'`, reintenta una vez tras 401 con `POST /auth/refresh` y si falla redirige a `/login?from=…`.
- `lib/auth.tsx` (`useAuth`: user, login, logout, setUser), `lib/theme.tsx` (modo claro/oscuro con clase `dark` y
  variables `--c-{token}-{bg|fg|border}` generadas desde `COLOR_TOKENS`), `lib/queries.ts` (hooks de React Query),
  `lib/format.ts` (días, fechas, etiquetas en español), `lib/today.ts` (**único** "hoy": `today()`).
- `components/ui/*` — button, card, dialog, input(+Textarea), label(+`Field`), select (nativo estilizado), badge, tabs,
  tooltip, dropdown, table, alert (con icono), avatar.
- `components/Legend.tsx` — leyenda de SPEC-19; ponla en toda vista de calendario.
- `components/calendar/*` — `DayCell` (todo el tratamiento visual), `MiniMonth`, `MonthGrid`, `model.ts` (`makeDayLookup`).
- `components/DangerConfirmDialog.tsx` — acciones peligrosas (SPEC-11 punto 2): `confirmWord` ("ANULAR", "REGISTRAR"…),
  motivo obligatorio, `impact`, `warning`; `onConfirm({reason})` debe lanzar si falla.
- `components/Layout.tsx` (barra lateral / menú móvil, campana, tema, menú de usuario), `NotificationBell.tsx`, `PageHeader.tsx`.
- `features/<área>/` — una carpeta por pantalla. `features/admin/AdminRoutes.tsx` es el punto de montaje de `/admin/*`
  (export default; solo accesible con role admin; la ruta ya está en `App.tsx` y el enlace "Administración" en el Layout).
- `features/requests/RequestList.tsx` — lista con cancelar/modificar según `request.can` (reutilizable; `StatusBadge`).

## Convenciones
- Colores de calendario/leyenda: **solo** `COLOR_TOKENS` vía variables CSS (`var(--c-approved-bg)`…). El color nunca va solo:
  icono, patrón (rayado = pendiente, diagonal = medio día), `aria-label` y tooltip.
- Estados de color de UI general: tokens shadcn (`bg-primary`, `text-destructive`, `bg-warning`).
- Tras mutaciones de solicitudes invalida `REQUEST_DEPENDENT_KEYS` (ver `lib/queries.ts`).
- Errores de API: `errorMessage(e)` → texto en español para `toast.error` o `<Alert variant="destructive">`.
- Después de editar: `npx tsc -p client --noEmit`, `npx eslint client`, `npm run build -w client`.

## data-testid principales
Login: `login-form|login-email|login-password|login-submit|login-error`. Nav: `nav-home|nav-request|nav-calendar|nav-team|nav-admin|user-menu|logout|theme-toggle|notification-bell`.
Dashboard: `request-vacation-button`, `kpi-{available|carryover|birthday|enjoyed|pending|total}[-value]`, `expiry-banner` (`data-level`), `request-{id}`, `request-cancel-{id}`, `request-modify-{id}`, `cancel-confirm`, `history-status|history-year`.
Solicitud: `request-form|request-kind|mode-{range|day|half}|request-start|request-end|request-period|request-comment|request-submit|request-error`, `preview|preview-summary|preview-error|preview-warning|preview-allocation|preview-balance|preview-day-{fecha}`.
Calendario: `tab-year|tab-month|cal-prev|cal-next|year-grid|month-grid|day-{YYYY-MM-DD}|legend`. Equipo: `team-scope|team-manager|team-table|team-totals|team-row-{id}`.
Peligro: `{testId}-dialog|-warning|-impact|-reason|-confirm-text|-submit|-cancel|-error` (por defecto `danger-…`).
