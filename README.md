# holidayTracker

Aplicación interna para gestionar las vacaciones de un equipo de Madrid. Solo cubre vacaciones y el día de cumpleaños; no incluye bajas, permisos retribuidos ni asuntos propios.

Funcionalidades principales: solicitud y aprobación de vacaciones por el manager, saldo por bolsas (año en curso, arrastrados y cumpleaños), calendario de equipo, festivos de Madrid, notificaciones por email y auditoría de acciones sensibles.

## Stack

- **Servidor:** Node.js, Express, Mongoose (MongoDB con replica set para transacciones), Zod, node-cron, nodemailer.
- **Cliente:** React, Vite, Tailwind CSS, shadcn/ui.
- **Compartido:** motor de cómputo puro (días laborables, prorrata, bolsas, cumpleaños), tipos y schemas.
- **Tests:** Vitest (unitarios y API), Playwright (e2e).

## Estructura del monorepo

```
shared/   motor puro (cómputo, bolsas, cumpleaños, límites), fechas, tipos del contrato HTTP y schemas Zod
server/   API Express + Mongoose. Capas: rutas y política → servicios de dominio → modelos
client/   interfaz React + Vite. Solo presenta y llama a la API
docs/     modelo de datos, decisiones, despliegue e informe
```

El servidor siempre recalcula los días de una solicitud; el front solo envía fechas.

## Requisitos

- Node.js 20 o superior.
- npm (workspaces).
- MongoDB con replica set solo en producción. En desarrollo no hace falta: se arranca uno en memoria.

## Desarrollo local

```bash
npm install
npm run dev
```

- **Servidor:** http://localhost:3000 (API en `/api`). Si no hay `MONGODB_URI`, arranca un MongoDB en memoria con replica set de un nodo. Si la base de datos está vacía, carga el seed automáticamente (`SEED_ON_EMPTY`).
- **Front:** http://localhost:5173 (Vite).

Como la base en memoria se pierde al parar el servidor, el seed se vuelve a cargar en cada arranque.

### Usuarios del seed

Contraseña común para todos: **`vacaciones2026`**

| Email | Nombre | Rol | Manager |
|---|---|---|---|
| ana.admin@holidaytracker.local | Ana Directora | admin | — (raíz) |
| bruno.manager@holidaytracker.local | Bruno Manager | admin | Ana |
| carla.manager@holidaytracker.local | Carla Manager | admin | Ana |
| diego.ruiz@holidaytracker.local | Diego Ruiz | user | Bruno |
| marta.sanchez@holidaytracker.local | Marta Sánchez | user | Bruno |
| javier.lopez@holidaytracker.local | Javier López | user | Bruno |
| lucia.fernandez@holidaytracker.local | Lucía Fernández | user | Carla |
| pablo.martin@holidaytracker.local | Pablo Martín | user | Carla |
| sara.gomez@holidaytracker.local | Sara Gómez | user | Carla |

Los managers tienen rol `admin` porque aprueban solicitudes de su equipo. Javier tiene fecha de alta en 2026-06-15 (prorrata).

## Scripts (raíz)

| Script | Qué hace |
|---|---|
| `npm run dev` | Arranca el servidor (:3000) y el front (:5173) en paralelo. |
| `npm run dev:server` | Solo el servidor, con recarga automática. |
| `npm run build` | Compila el cliente y el servidor. |
| `npm start` | Arranca el servidor compilado (`server/dist`). |
| `npm test` | Tests unitarios y de API con Vitest. |
| `npm run test:watch` | Vitest en modo observación. |
| `npm run test:coverage` | Tests con informe de cobertura. El objetivo es el 90 % en `shared/engine` y los servicios de saldo. |
| `npm run test:e2e` | Flujos clave con Playwright (invitar, solicitar, aprobar, cancelar, anular). |
| `npm run e2e:install` | Instala el navegador Chromium que usa Playwright. Hay que ejecutarlo una vez antes de `test:e2e`. |
| `npm run lint` | ESLint sobre todo el monorepo. |
| `npm run typecheck` | Comprueba los tipos de `shared`, `server` y `client`. |
| `npm run seed` | Carga el seed de desarrollo con los servicios de dominio. |
| `npm run job -- <job> [--year=NNNN]` | Lanza un job a mano (ver más abajo). |

## Variables de entorno

Se leen de `.env` en la raíz (opcional; `npm run dev` lo carga si existe). Valores de `server/src/config/env.ts`.

| Variable | Defecto | Para qué sirve |
|---|---|---|
| `NODE_ENV` | `development` | Entorno. En `production` activa las comprobaciones obligatorias. |
| `PORT` | `3000` | Puerto del servidor. |
| `MONGODB_URI` | *(vacío)* | Conexión a MongoDB (replica set). Vacío = Mongo en memoria (solo desarrollo). **Obligatoria en producción.** |
| `JWT_SECRET` | valor de desarrollo | Firma de los tokens de acceso. **Obligatoria en producción.** |
| `APP_URL` | `http://localhost:5173` | URL pública de la app; se usa en los enlaces de los emails. |
| `CORS_ORIGIN` | *(vacío)* | Origen permitido para CORS, si el front se sirve desde otro dominio. |
| `COOKIE_SECURE` | `true` en producción | Marca las cookies de sesión como `secure` (solo HTTPS). |
| `MAIL_TRANSPORT` | `console` | `console` (log + ficheros), `smtp` o `resend`. |
| `MAIL_FROM` | `holidayTracker <no-reply@holidaytracker.local>` | Remitente de los emails. |
| `MAIL_DIR` | `tmp/mails` | Carpeta donde el transporte `console` guarda los emails. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` | `""` / `587` / `""` / `""` / `false` | Credenciales del servidor SMTP (si `MAIL_TRANSPORT=smtp`). |
| `RESEND_API_KEY` | *(vacío)* | Clave de API de Resend (si `MAIL_TRANSPORT=resend`). |
| `CRON_ENABLED` | `true` (salvo en tests) | Activa las tareas programadas. |
| `RATE_LIMIT_ENABLED` | `true` (salvo en tests) | Límite de peticiones en login, recuperación de contraseña y aceptación de invitaciones. |
| `NAGER_BASE_URL` | `https://date.nager.at` | Origen de la API pública de festivos para importarlos. |
| `SEED_ON_EMPTY` | `true` (salvo en producción) | Carga el seed al arrancar si la base de datos está vacía. |

## Emails en desarrollo

Con `MAIL_TRANSPORT=console` (por defecto) no se envía nada real. Cada email se escribe en el log del servidor y se guarda como fichero en `server/tmp/mails/` (la ruta es relativa al directorio de trabajo del servidor, `MAIL_DIR`).

## Jobs

Los jobs son tareas idempotentes con lock en Mongo y registro de cada ejecución (colección `jobRuns`). Se ejecutan solos según el planificador (si `CRON_ENABLED`), al arrancar (recuperación de lo que no se ejecutó) o a mano.

Lanzar un job desde la línea de comandos:

```bash
npm run job -- year-close --year=2026
```

El resultado se imprime en JSON. Si el job falla, el proceso termina con código 1. `--year` es opcional.

También se pueden lanzar desde **Administración → Jobs** en la app.

**Advertencia:** sin `MONGODB_URI`, `npm run job` arranca una base en memoria vacía, así que no afecta a los datos del servidor de desarrollo. Para actuar sobre datos reales hay que apuntar `MONGODB_URI` al mismo replica set.

| Job | Qué hace | Año por defecto |
|---|---|---|
| `year-close` | Cierra un año: calcula los días arrastrados, la caducidad de los cumpleaños, reasigna enero y febrero y congela el ledger de ese año. Se ejecuta el 1 de enero. | Año anterior al actual |
| `carryover-expiry` | Caduca los días arrastrados que no se han disfrutado antes del último día de febrero. Se ejecuta el 1 de marzo. | Año actual |
| `expiry-reminders` | Avisa a los usuarios con días arrastrados a punto de caducar. Diario a las 9:00. | — |
| `escalation` | Escala las solicitudes pendientes antiguas (más de `escalationHours`) o cuya fecha de inicio ya ha llegado (urgentes). Cada hora. | — |
| `pending-digest` | Envía a cada aprobador un resumen de sus solicitudes pendientes antiguas. Diario a las 9:00. | — |
| `holidays-check` | Si el 1 de octubre o después faltan los festivos del año siguiente, avisa a los admins. Se ejecuta el 1 de octubre. | — |

## Reglas de negocio clave

- **Unidades:** todos los saldos se guardan en **medios días** (1 día = 2 unidades). Solo se convierten a días al mostrarlos. Un día computable es un lunes a viernes que no sea festivo del calendario del usuario, y puede ser medio día.
- **Ledger:** el saldo es la suma de los movimientos de `ledgerEntries`, que solo admite inserciones. Las solicitudes pendientes reservan días, pero no están en el ledger. El disponible es el saldo menos lo reservado.
- **Bolsas:** `CURRENT` (año en curso), `CARRYOVER` (arrastrados, que hay que disfrutar antes del último día de febrero) y `BIRTHDAY` (día de cumpleaños, caduca el 31 de diciembre).
- **Arrastre:** el cierre del año pasa el saldo sobrante a la bolsa `CARRYOVER` del año siguiente, sin tope. Un saldo negativo también pasa al año siguiente.
- **Límite negativo:** no se puede pedir por encima de un saldo de **−5 días**.
- **Cumpleaños:** cada usuario tiene un día libre al año. Si cae en fin de semana o festivo, se mueve a un día laborable del mismo mes.
- **Aprobación:** la aprueba el manager del solicitante (o un admin distinto del solicitante). Nadie aprueba ni anula sus propias solicitudes. Al aprobar se revalida el saldo.
- **Estados:** `PENDING` → `APPROVED` / `REJECTED`; `APPROVED` → `CANCELLED` (antes de empezar) o `REVOKED` (anulada por un admin). Cancelar o anular devuelve los días al ledger (`REFUND`).
- **Modificar** una solicitud es crear otra que sustituye a la original (`replacesRequestId`).
- **Acciones sensibles** (ajustes, anulaciones, registros retroactivos, jobs) quedan en `auditLogs`.

## Documentación

- [docs/DATA_MODEL.md](docs/DATA_MODEL.md): colecciones, índices, endpoints, estados y seguridad.
- [docs/DECISIONS.md](docs/DECISIONS.md): decisiones tomadas en modo autónomo, con alternativas descartadas.
- [docs/DEPLOY.md](docs/DEPLOY.md): despliegue en producción.
- [docs/REPORT.md](docs/REPORT.md): informe del proyecto.

## Despliegue en Railway

Resumen; los pasos completos están en [docs/DEPLOY.md](docs/DEPLOY.md).

- Un único servicio para la app (servidor + build estático del cliente) y un servicio de **MongoDB** con replica set.
- Variables: `MONGODB_URI` y `JWT_SECRET` (obligatorias), `TZ=Europe/Madrid`, `APP_URL`, `NODE_ENV=production`.
- Healthcheck: `GET /api/health` (comprueba la conexión a Mongo).
- Las fechas de calendario se manejan siempre como `YYYY-MM-DD`; `TZ` es una salvaguarda, no un sustituto.
