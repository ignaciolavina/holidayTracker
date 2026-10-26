# holidayTracker — Modelo de datos, API y estados (SPEC-01)

> Entregable de SPEC-01. Unidades de saldo: **medios días** (1 día = 2). Fechas de calendario `YYYY-MM-DD`.
> Tipos TypeScript del contrato: `shared/src/api.ts`. Schemas de entrada: `shared/src/schemas.ts`.

## 1. Arquitectura

```
shared/   motor puro (cómputo, prorrata, bolsas, cumpleaños, límites), fechas, tipos, schemas Zod, colores
server/   Express + Mongoose. Capas: http (rutas + política) → services (dominio) → models
client/   React + Vite + Tailwind + shadcn/ui. Solo presenta y llama a la API
```

- El front usa `shared/` para previsualizar; **el servidor siempre recalcula** (ignora cualquier número de días que llegue).
- `server/src/lib/clock.ts`: reloj inyectable (`clock.now()`, `clock.today()` = `todayMadrid(now)`). Los tests lo fijan.
- Un único proceso sirve `/api` y el build estático de `client/dist` (Railway: un servicio + MongoDB).

## 2. Colecciones

| Colección | Campos | Índices |
|---|---|---|
| `users` | email (único, minúsculas), name, passwordHash, role `admin`/`user`, managerId?, holidayCalendarId, hireDate, leaveDate?, birthday `MM-DD`?, birthdayLocked, annualUnits, annualHistory `[{from, units}]`, status `active`/`invited`/`disabled`, tokenVersion, avatarUrl?, lockVersion | `{email}` único, `{managerId}` |
| `invitations` | email, name, tokenHash, invitedBy, payload {role, managerId, holidayCalendarId, hireDate, annualUnits, birthday?}, userId, expiresAt, usedAt?, revokedAt? | `{tokenHash}` único, `{email}` |
| `sessions` | userId, family, tokenHash, expiresAt, revokedAt?, replacedBy? (refresh rotativo) | `{tokenHash}` único, TTL `expiresAt` |
| `passwordResets` | userId, tokenHash, expiresAt (1 h), usedAt? | `{tokenHash}` único, TTL |
| `holidayCalendars` | name, regionCode `ES-MD`, localityName, isDefault | |
| `holidays` | date, name, scope `national`/`regional`/`local`, calendarIds[], source `import`/`manual`, year | `{date, calendarIds}`, `{year}` |
| `vacationRequests` | userId, kind `VACATION`/`BIRTHDAY`, startDate, endDate, halfDay? {date, period}, status, units, breakdown {days[], allocation[]}, comment?, approverId?, decidedBy?, decidedAt?, rejectionReason?, replacesRequestId?, cancelReason?, revokedFromDate?, revokeReason?, urgentAt?, escalatedAt?, retroactive, createdBy | `{userId, startDate}`, `{status, approverId}`, `{status, startDate}` |
| `ledgerEntries` | userId, year, bucket `CURRENT`/`CARRYOVER`/`BIRTHDAY`, type, units (±), requestId?, reason?, createdBy?, idempotencyKey (único), createdAt | `{userId, year, bucket}`, `{idempotencyKey}` único, `{requestId}` |
| `userYears` | userId, year, closed, closedAt?, carryoverExpiresOn, version | `{userId, year}` único |
| `notifications` | userId, type, title, body, link?, payload, readAt? | `{userId, readAt, createdAt}` |
| `mailQueue` | to, subject, html, text, status `pending`/`sent`/`failed`, attempts, nextAttemptAt, lastError? | `{status, nextAttemptAt}` |
| `auditLogs` | actorId?, action, targetType, targetId?, before, after, reason?, ip?, createdAt | `{targetId, createdAt}`, `{action, createdAt}`, `{actorId, createdAt}` |
| `settings` | documento único `_id: 'global'` con los valores de la sección 0/8 | |
| `jobRuns` | job, key (único por ejecución lógica, p. ej. `year-close:2026`), status, trigger, startedAt, finishedAt, result, error | `{key}` único |
| `jobLocks` | `_id` = nombre del job, owner, lockedUntil | |

**Inmutables desde la app:** `ledgerEntries` y `auditLogs` (el modelo bloquea `update*`/`delete*` con hooks; no hay endpoints).

## 3. Saldo y ledger

- Saldo de una bolsa en un año = Σ `units` de sus movimientos. **Reservado** = unidades de solicitudes `PENDING` (asignadas
  con la misma regla de orden de consumo). **Disponible** = ledger − reservado.
- Apertura de año (`ensureYearOpen`): `ANNUAL_ALLOWANCE` (prorrateada) y `BIRTHDAY_ALLOWANCE` (si es elegible), idempotentes por
  `idempotencyKey`. Se abre el año de alta al crear el usuario, el año siguiente cuando hace falta (solicitud a futuro) y en el cierre.
- Cambios de `annualUnits`, alta o baja → `syncEntitlement` inserta `PRORATION_ADJUSTMENT` = derecho recalculado − derecho ya concedido.
- Cierre del año N: `CARRYOVER_IN` (N+1, CARRYOVER) o `NEGATIVE_CARRYOVER` (N+1, CURRENT), `BIRTHDAY_EXPIRY` (N), reasignación
  `REALLOCATION` de enero/febrero de N+1, `userYears(N).closed = true`. El ledger de N queda congelado (no admite más inserciones).
- Claves de idempotencia: `allowance:{u}:{y}`, `birthday-allowance:{u}:{y}`, `consume:{req}:{y}:{bucket}`, `refund:{req}:{y}:{bucket}`,
  `carryover-in:{u}:{y}`, `carryover-expiry:{u}:{y}`, `birthday-expiry:{u}:{y}`, `realloc:{req}:{y}`, `holiday-recalc:{req}:{change}:{y}:{bucket}`,
  `adjust:{auditId}`, `proration:{u}:{y}:{n}`.

### Consistencia y concurrencia

Mongo se ejecuta como **replica set** (en desarrollo y tests, `MongoMemoryReplSet` de un nodo; en Railway, replica set de un nodo
o Atlas). Toda escritura de solicitud + ledger va en una **transacción** (`withTransaction`). Al empezar, la transacción hace
`$inc` de `userYears.version` de cada año afectado: dos transacciones concurrentes del mismo usuario escriben el mismo documento,
una de ellas aborta con `WriteConflict` y el driver la reintenta, ya viendo la reserva de la otra → **no hay doble gasto**
(test obligatorio en `server/test/concurrency.test.ts`). Además `idempotencyKey` único impide duplicar movimientos.

## 4. Estados de la solicitud

```
            ┌──────────── aprobar (admin ≠ solicitante; revalida saldo) ─────────┐
            │                                                                    ▼
 PENDING ───┼── rechazar (motivo obligatorio) ──▶ REJECTED                 APPROVED ──cancelar (usuario, antes de iniciar)──▶ CANCELLED (+REFUND)
            │                                                                │
            └── cancelar (usuario, antes de iniciar) ──▶ CANCELLED            └──anular (admin ≠ solicitante, motivo, "ANULAR")──▶ REVOKED (+REFUND total o desde fecha)
```

- Modificar = nueva solicitud con `replacesRequestId`. Al aprobarla, en la misma transacción: original → `CANCELLED` + `REFUND`, nueva consume.
- Transiciones con actualización condicional `{_id, status: <esperado>}`.
- `PENDING` con `startDate ≤ hoy` → urgente (`urgentAt`) y se escala.
- Registro retroactivo (admin): se crea directamente `APPROVED` con `retroactive: true`, motivo y confirmación `REGISTRAR`.

## 5. Endpoints

Política por endpoint: `public`, `auth` (cualquier sesión), `admin`. Las reglas finas (p. ej. "no sobre uno mismo") están en los servicios.
Cada ruta se registra con `route(router, method, path, policy, handler)`; un test recorre todas y falla si alguna no tiene política.

| Método | Ruta | Política | Descripción |
|---|---|---|---|
| GET | /api/health | public | estado + conexión a Mongo |
| POST | /api/auth/login | public (rate limit) | `{email,password}` → `{user: Me}` + cookies |
| POST | /api/auth/refresh | public | rota el refresh token |
| POST | /api/auth/logout | public | revoca la sesión |
| GET | /api/auth/me | auth | `Me` |
| POST | /api/auth/forgot | public (rate limit) | siempre 204 (sin enumeración) |
| POST | /api/auth/reset | public (rate limit) | `{token,password}` |
| GET | /api/invitations/token/:token | public | `InvitationInfo` |
| POST | /api/invitations/accept | public | `{token,password,birthday?}` → `{user}` + cookies |
| PATCH | /api/me | auth | nombre, avatar |
| POST | /api/me/password | auth | cambio de contraseña (invalida otras sesiones) |
| POST | /api/me/birthday | auth | fija el cumpleaños (solo una vez) |
| GET | /api/users | auth | `UserSummary[]` (admin: `UserDetail[]`) |
| GET | /api/users/:id | admin | `UserDetail` |
| PATCH | /api/users/:id | admin | rol, manager, calendario, alta, días anuales, cumpleaños (motivo) |
| POST | /api/users/:id/deactivate | admin | `{leaveDate}` → `SettlementDto` |
| POST | /api/users/:id/reactivate | admin | |
| GET | /api/users/:id/settlement | admin | `SettlementDto` |
| GET | /api/invitations | admin | `InvitationDto[]` |
| POST | /api/invitations | admin | invitar (`inviteSchema`) |
| POST | /api/invitations/:id/resend | admin | token nuevo |
| POST | /api/invitations/:id/revoke | admin | |
| GET | /api/org/tree | auth | `OrgNode[]` (saldos solo para admin) |
| GET | /api/holiday-calendars | auth | `HolidayCalendarDto[]` |
| GET | /api/holidays?year=&calendarId= | auth | `HolidayDto[]` |
| GET | /api/holidays/status | admin | `{year, nextYearMissing}` |
| POST | /api/holidays/import/preview | admin | `{year}` → `HolidayDraftItem[]` (Nager.Date) |
| POST | /api/holidays/import/confirm | admin | `{year, holidays[]}` |
| POST | /api/holidays/impact | admin | `HolidayImpact` antes de confirmar |
| POST | /api/holidays | admin | crear (si hay impacto exige `confirm`) |
| PATCH | /api/holidays/:id | admin | editar |
| DELETE | /api/holidays/:id | admin | borrar |
| POST | /api/requests/preview | auth | `RequestPreview` (admin puede pasar `userId`) |
| POST | /api/requests | auth | crear solicitud propia |
| POST | /api/requests/retroactive | admin | registro retroactivo para otro usuario |
| GET | /api/requests?userId=&status=&year= | auth | propias; admin cualquiera |
| GET | /api/requests/:id | auth | propia o admin |
| POST | /api/requests/:id/cancel | auth | solicitante, antes de iniciar |
| POST | /api/requests/:id/approve | admin | `canApprove` + revalidación |
| POST | /api/requests/:id/reject | admin | motivo |
| POST | /api/requests/:id/revoke/preview | admin | `{refundUnits, enjoyedUnits}` |
| POST | /api/requests/:id/revoke | admin | motivo + `ANULAR` |
| GET | /api/approvals/link/:token | auth | valida enlace firmado del email → `{requestId}` |
| GET | /api/admin/overview | admin | `AdminOverviewDto` |
| GET | /api/balances/me?year= | auth | `BalanceDto` |
| GET | /api/balances?year= | admin | `BalanceRow[]` |
| GET | /api/balances/export.csv?year= | admin | CSV |
| GET | /api/balances/:userId?year= | admin | `BalanceDto` |
| GET | /api/ledger/me?year= | auth | `LedgerEntryDto[]` |
| GET | /api/ledger/:userId?year= | admin | `LedgerEntryDto[]` |
| POST | /api/balances/:userId/adjust | admin | ajuste (no sobre uno mismo) |
| GET | /api/calendar/me?year= | auth | `UserCalendarDto` |
| GET | /api/calendar/user/:userId?year= | admin | `UserCalendarDto` |
| GET | /api/calendar/team?month=&scope=&managerId= | auth | `TeamCalendarDto` (sin comentarios ni saldos) |
| GET | /api/calendar/out?from=&to= | auth | `OutDto` |
| GET | /api/notifications | auth | `{items, unread}` |
| POST | /api/notifications/:id/read | auth | |
| POST | /api/notifications/read-all | auth | |
| GET | /api/audit | admin | `Paginated<AuditLogDto>` |
| GET | /api/audit/export.csv | admin | CSV |
| GET | /api/settings | auth | `Settings` |
| PATCH | /api/settings | admin | |
| GET | /api/jobs | admin | `JobRunDto[]` |
| POST | /api/jobs/:name/run | admin | lanzar un job a mano |

Errores: `{ error: { code, message } }` con mensaje en español. 400 validación, 401 sin sesión, 403 permiso, 404, 409 conflicto
de estado, 422 regla de negocio.

## 6. Seguridad

- Access JWT (15 min) en cookie `ht_access` (`httpOnly`, `sameSite=lax`, `secure` en producción) con `sub` y `tv` (tokenVersion).
  Refresh opaco (30 días) en cookie `ht_refresh` (path `/api/auth`), guardado hasheado en `sessions`, **rotativo con detección
  de reutilización** (reusar uno ya rotado revoca toda la familia).
- Cada request recarga el usuario: si `status !== 'active'` o `tokenVersion` no coincide → 401.
- CSRF: cookies `sameSite=lax` + las peticiones que modifican exigen la cabecera `X-Requested-With: holidaytracker` (no se
  puede enviar desde otro origen sin preflight, y CORS está cerrado) y se valida `Origin` si llega.
- `helmet`, rate limit en login / forgot / reset / accept, bcrypt coste 12.

## 7. Preparado para la fase 2

`holidayCalendars` múltiples por centro; `settings` admite nuevas claves (periodos bloqueados, antelación, máximo por equipo);
`notifications` con `type` libre para un canal Slack; `vacationRequests` aprobadas → feed iCal derivable sin cambios de modelo.
