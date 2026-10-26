# holidayTracker — Especificación del proyecto

> App web para gestionar las vacaciones de un equipo con sede en Madrid.
> Interfaz en español · Zona horaria `Europe/Madrid` · Solo vacaciones: ni bajas médicas ni otros tipos de ausencia.

---

## ⚡ MODO DE EJECUCIÓN AUTÓNOMO — LEER ANTES QUE NADA

**Este proyecto se ejecuta sin supervisión.** Ignacio no está disponible mientras trabajas y espera encontrarlo **todo terminado** a su vuelta. Estas reglas tienen prioridad sobre cualquier otra parte del documento.

### R1. Nunca pidas confirmación ni hagas preguntas
- No te pares a preguntar en ningún punto: ni entre fases, ni al terminar el diseño, ni ante una duda.
- Ante cualquier duda, **toma la decisión más razonable** según esta spec y apúntala en `docs/DECISIONS.md` con este formato: `fecha · spec · decisión · alternativas descartadas · por qué`. Todo se puede corregir después.
- Para las decisiones abiertas de la sección 8, usa el valor por defecto que se indica allí.
- No uses la herramienta de preguntas al usuario (AskUserQuestion) ni el modo plan con aprobación.

### R2. Todos los permisos, al principio (paso 0, antes de escribir código)
El objetivo es que cualquier aviso de permisos salte en los **primeros minutos** y que después no vuelva a aparecer ninguno.

1. Comprueba que existe `.claude/settings.json`, con las listas `allow` y `deny`. Si falta, créalo con el contenido del bloque de abajo. Si vas a necesitar algún comando más, **añádelo ahora**, no a mitad de trabajo.
2. Crea la estructura del monorepo e **instala de una vez todas las dependencias previstas** de `server/`, `client/` y `shared/` (incluidas las de desarrollo: Vitest, Playwright, mongodb-memory-server, etc.). Después ejecuta `npx playwright install chromium`.
3. Ejecuta una vez cada comando que vayas a usar durante el proyecto: `npm run build`, `npm test`, `npm run lint`, `npm run typecheck`, un arranque de prueba del servidor de desarrollo, `git add` y `git commit`.
4. Ejecuta `git init` si no existe el repo. Haz el primer commit: `chore: scaffold + permisos`.
5. A partir de ese momento, **usa solo comandos que estén en la lista `allow`**. Si te hace falta algo que no está, busca una alternativa que sí lo esté. Si no la hay, apúntalo en `docs/BLOCKERS.md` y sigue con otra cosa.

```json
{
  "permissions": {
    "allow": [
      "Read", "Edit", "Write", "Glob", "Grep",
      "Bash(npm:*)", "Bash(npx:*)", "Bash(node:*)", "Bash(tsc:*)",
      "Bash(git init:*)", "Bash(git add:*)", "Bash(git commit:*)", "Bash(git status:*)",
      "Bash(git diff:*)", "Bash(git log:*)", "Bash(git checkout:*)", "Bash(git branch:*)",
      "Bash(git restore:*)", "Bash(git stash:*)", "Bash(git rev-parse:*)", "Bash(git show:*)",
      "Bash(mkdir:*)", "Bash(ls:*)", "Bash(cat:*)", "Bash(cp:*)", "Bash(mv:*)", "Bash(touch:*)",
      "Bash(rm:*)", "Bash(find:*)", "Bash(grep:*)", "Bash(sed:*)", "Bash(head:*)", "Bash(tail:*)",
      "Bash(wc:*)", "Bash(echo:*)", "Bash(pwd)", "Bash(which:*)", "Bash(sort:*)", "Bash(diff:*)",
      "Bash(lsof:*)", "Bash(kill:*)", "Bash(pkill:*)", "Bash(sleep:*)", "Bash(curl:*)",
      "WebFetch(domain:date.nager.at)", "WebFetch(domain:www.npmjs.com)", "WebFetch(domain:code.claude.com)"
    ],
    "deny": [
      "Bash(git push:*)", "Bash(git remote:*)", "Bash(railway:*)", "Bash(sudo:*)", "Bash(brew:*)",
      "Bash(npm install -g:*)", "Bash(npm i -g:*)", "Bash(npm publish:*)", "Bash(npm login:*)"
    ]
  }
}
```

### R3. Ejecuta todo seguido
- Haz todas las fases de la sección 6, **de la 0 a la 7, sin parar**.
- Los subagentes (Sonnet o Haiku) trabajan con las mismas reglas: tampoco preguntan. Opus revisa su trabajo (sección 5) y sigue adelante.

### R4. Git
- Trabaja en la rama local `main`.
- Haz **un commit al terminar cada spec**, siempre con los tests pasando. El mensaje sigue el formato `feat(SPEC-07): saldo, ledger y arrastre`.
- Así cada fase se puede revisar y revertir por separado.

### R5. Prohibido
- Hacer `git push`, desplegar en Railway o tocar remotos.
- Instalar nada a nivel de sistema o global (`brew`, `sudo`, `npm -g`).
- Leer o escribir fuera de esta carpeta.
- Usar credenciales reales o **enviar emails reales**. En desarrollo, el transporte de email es `console` (escribe en log y en `server/tmp/mails/`).

### R6. Base de datos local
- Usa `mongodb-memory-server` con **`MongoMemoryReplSet`** tanto en los tests como en `npm run dev` si `MONGODB_URI` no está definido. Al ser un replica set, permite **transacciones**, así que usa esa estrategia (SPEC-01).
- `npm run dev` carga el seed automáticamente si la base de datos está vacía.

### R7. Si algo se atasca
- Si algo falla después de 3 intentos razonables, apúntalo en `docs/BLOCKERS.md` (qué, por qué y qué has probado) y **continúa con la siguiente spec que no dependa de ello**.
- No te quedes en bucle. No elimines ni debilites tests para conseguir que pasen.

### R8. Entrega final
Al terminar, deja escrito `docs/REPORT.md` con:
1. El estado de cada spec (✅ hecha / ⚠️ parcial / ❌ bloqueada) y su commit.
2. El resultado de los tests y la cobertura del motor.
3. El resumen de `DECISIONS.md` y `BLOCKERS.md`.
4. Cómo arrancarlo (`npm install && npm run dev`) y los usuarios del seed con sus contraseñas.
5. Lo que falta para desplegar en Railway (variables de entorno y pasos).

Actualiza también el README.

---

## 0. Decisiones y valores por defecto

Todos los valores son configurables por un admin desde **Configuración**, salvo los que se indiquen como fijos.

| Concepto | Valor por defecto |
|---|---|
| Días de vacaciones por año | **24 días laborables** (editable por usuario) |
| Día de cumpleaños | **+1 día** por año, con un saldo propio que no se arrastra |
| Unidad de cómputo | Días laborables: de lunes a viernes, sin contar los festivos del calendario del usuario |
| Medio día | Sí, de mañana o de tarde, y computa 0,5 |
| Días del año anterior | Se arrastran al año siguiente y **caducan el último día de febrero** (28 o 29) |
| Saldo negativo | Permitido hasta **-5 días**. A partir de ahí, la solicitud se bloquea |
| Tipos de ausencia | **Solo vacaciones** (más el día de cumpleaños como saldo aparte) |
| Aprobación | **Cualquier admin** puede aprobar o rechazar, salvo sus propias solicitudes. El manager directo (según el árbol) aparece como **aprobador asignado**, pero solo a nivel informativo, no es una restricción |
| Avisos de pendientes | Si una solicitud lleva más de 48 h pendiente, o el manager está de vacaciones, se avisa también al manager del manager y al resto de admins |
| Festivos | Tres niveles: nacional, autonómico (Comunidad de Madrid) y local (municipio de Madrid) |
| Solicitudes a futuro | Hasta el 31 de diciembre del año siguiente |

---

## 1. Stack y despliegue

- **Node.js + TypeScript** (`strict`) en todo el proyecto.
- **MongoDB** con Mongoose.
- **Backend:** Express con una API REST bajo `/api`.
- **Frontend:** React + Vite + TypeScript, con Tailwind y shadcn/ui.
- **Un único servicio en Railway**: el backend sirve el build estático del front. A eso se suma un servicio de MongoDB.
- Monorepo con `server/`, `client/` y `shared/`. La carpeta `shared/` contiene los schemas de Zod, los tipos y el motor de cómputo de días, que se comparten para poder mostrar previsualizaciones en el front. **El servidor siempre recalcula y es la única fuente de verdad.**
- Emails con Resend (o SMTP configurable mediante Nodemailer).
- Tareas programadas con `node-cron` configurado con `timezone: 'Europe/Madrid'`.
- Tests con Vitest (unitarios y de API) y Playwright (e2e de los flujos clave).
- Railway: `PORT`, healthcheck en `/api/health`, scripts `build` y `start`, y un `.env.example` completo.

### Reglas técnicas transversales (no negociables)

1. **Las fechas de calendario se guardan como string `YYYY-MM-DD`**, nunca como `Date` con hora. Esto aplica a las fechas de las vacaciones, los festivos, el cumpleaños, la fecha de alta y la de baja. Los instantes (`createdAt`, `approvedAt`…) sí se guardan como `Date` en UTC.
2. **"Hoy" significa la fecha actual en `Europe/Madrid`**. Hay que usar una única función `todayMadrid()` y no llamar a `new Date()` repartido por el código.
3. **Los saldos se guardan como enteros de medios días.** Por ejemplo, 24 días equivalen a `48` unidades. Así se evitan los errores de coma flotante. Solo se convierten a días al mostrarlos.
4. **El saldo no se guarda como un número suelto**: se calcula a partir de un ledger de movimientos que solo admite inserciones (sección SPEC-07).
5. **Toda la lógica de negocio vive en el servidor.** El front nunca envía "cuántos días son", solo las fechas.

---

## 2. Reparto de trabajo por modelo

| Etiqueta | Quién la implementa | Revisión |
|---|---|---|
| 🟣 **OPUS** | **Claude Opus 5.5** diseña y escribe el código | Opus revisa su propio trabajo pasando la checklist de la sección 5, y los tests escritos antes de implementar tienen que pasar |
| 🔵 **SONNET + revisión OPUS** | **Claude Sonnet 5.5** implementa | **Opus revisa siempre** el diff contra la spec y la checklist de la sección 5 antes de hacer merge |
| ⚪ **HAIKU + revisión OPUS** | **Claude Haiku 5.5** para tareas mecánicas (seed, textos, README) | **Opus revisa siempre** |

**Criterio:** todo lo que toca dinero/tiempo (saldos, cómputo de días), seguridad (auth, permisos), integridad (anti-trampas, concurrencia) o tareas programadas irreversibles es 🟣 OPUS. Las pantallas, el CRUD, las plantillas y la configuración se implementan con un modelo menor, y Opus las revisa siempre.

### Resumen

| Spec | Módulo | Modelo |
|---|---|---|
| SPEC-01 | Arquitectura y modelo de datos | 🟣 OPUS |
| SPEC-02 | Autenticación y sesiones | 🟣 OPUS |
| SPEC-03 | Invitaciones y gestión de usuarios | 🔵 SONNET + rev. OPUS |
| SPEC-04 | Roles, permisos y árbol de empleados | 🟣 OPUS |
| SPEC-05 | Festivos y calendarios | 🔵 SONNET + rev. OPUS (el impacto sobre solicitudes es 🟣, en SPEC-11) |
| SPEC-06 | Motor de cómputo de días | 🟣 OPUS |
| SPEC-07 | Saldo, ledger, prorrata, arrastre y caducidad | 🟣 OPUS |
| SPEC-08 | Día de cumpleaños | 🟣 OPUS |
| SPEC-09 | Solicitudes y máquina de estados | 🟣 OPUS |
| SPEC-10 | Aprobaciones y enrutado por árbol | 🟣 OPUS |
| SPEC-11 | Control anti-trampas | 🟣 OPUS |
| SPEC-12 | Auditoría | 🔵 SONNET + rev. OPUS (la lista de eventos la define Opus en SPEC-11) |
| SPEC-13 | Notificaciones (email e in-app) | 🔵 SONNET + rev. OPUS |
| SPEC-14 | Tareas programadas (cierre de año, caducidad, recordatorios) | 🟣 OPUS |
| SPEC-15 | Dashboard del usuario | 🔵 SONNET + rev. OPUS |
| SPEC-16 | Vista anual compacta y vista mensual | 🔵 SONNET + rev. OPUS |
| SPEC-17 | Calendario de equipo | 🔵 SONNET + rev. OPUS |
| SPEC-18 | Panel de administración | 🔵 SONNET + rev. OPUS |
| SPEC-19 | Sistema visual y leyenda de colores | 🔵 SONNET + rev. OPUS |
| SPEC-20 | Seed, README y despliegue en Railway | ⚪ HAIKU (seed, README) / 🔵 SONNET (config de Railway) + rev. OPUS |
| SPEC-21 | Estrategia de tests | 🟣 OPUS (casos del motor y anti-trampas) / 🔵 SONNET (API y e2e) |

---

## 3. Glosario

- **Día computable:** un día laborable de lunes a viernes que no es festivo en el calendario del usuario. Vale 1, o 0,5 si es medio día.
- **Bolsa (bucket):** cada saldo independiente del usuario en un año:
  - `CURRENT`: los días del año en curso.
  - `CARRYOVER`: los días arrastrados del año anterior, que caducan el último día de febrero.
  - `BIRTHDAY`: el día de cumpleaños, que caduca el 31 de diciembre.
- **Ledger:** el registro de movimientos de saldo, que solo admite inserciones. El saldo de una bolsa es la suma de sus movimientos.
- **Reservado:** los días de las solicitudes pendientes. No están en el ledger, pero cuentan para validar el límite.
- **Disponible:** el saldo del ledger menos lo reservado.
- **Año cerrado:** un año ya procesado por el cierre anual. Sus movimientos quedan congelados y solo se puede corregir con ajustes en el año abierto.
- **Solicitud iniciada:** una solicitud cuya `startDate` es anterior o igual a `todayMadrid()`.

---

## 4. Specs

### SPEC-01 · Arquitectura y modelo de datos — 🟣 OPUS

**Objetivo:** proponer y fijar las colecciones, los índices, los endpoints y la estrategia de consistencia **antes de escribir código de negocio**. Es el primer entregable. **No requiere confirmación** (R1): hay que documentarlo y seguir.

**Colecciones mínimas:**

| Colección | Campos clave |
|---|---|
| `users` | email (único), name, passwordHash, role (`admin` / `user`), managerId, holidayCalendarId, hireDate, leaveDate?, birthday (`MM-DD`), birthdayLocked, annualDays (en medios días), status (`active` / `invited` / `disabled`), tokenVersion |
| `invitations` | email, tokenHash, invitedBy, payload (rol, manager, días, alta…), expiresAt, usedAt?, revokedAt? |
| `holidayCalendars` | name, regionCode (`ES-MD`), localityName, isDefault |
| `holidays` | date, name, scope (`national` / `regional` / `local`), calendarIds[], source (`import` / `manual`), year |
| `vacationRequests` | userId, kind (`VACATION` / `BIRTHDAY`), startDate, endDate, halfDay? {date, period: `AM` / `PM`}, status, units, breakdown (snapshot del cómputo día a día y de la bolsa asignada), comment, approverId?, decidedBy?, decidedAt?, rejectionReason?, replacesRequestId?, cancelReason? |
| `ledgerEntries` | userId, year, bucket, type, units (± medios días), requestId?, reason?, createdBy, idempotencyKey (único), createdAt |
| `userYears` | userId, year, closed, carryoverExpiresOn, version (para bloqueo optimista) |
| `notifications` | userId, type, payload, readAt? |
| `auditLogs` | actorId, action, targetType, targetId, before, after, reason?, ip, createdAt |
| `settings` | un documento con los valores por defecto de la sección 0 |

**Consistencia y concurrencia:**

- Una solicitud y sus movimientos de ledger se escriben de forma atómica. Lo preferible son **transacciones de MongoDB**, que requieren un replica set: hay que comprobar si el Mongo de Railway lo es o configurarlo como replica set de un nodo. Si no se puede, el plan B es un bloqueo optimista sobre `userYears.version`, con `idempotencyKey` único en el ledger y un job de reconciliación.
- Dos solicitudes simultáneas del mismo usuario no pueden superar el límite (doble gasto). Esto se cubre con un test de concurrencia obligatorio.
- Índices: `vacationRequests {userId, startDate}`, `{status, approverId}`, `ledgerEntries {userId, year, bucket}`, `holidays {date, calendarIds}`, `auditLogs {targetId, createdAt}`.

**Entregable:** el documento del modelo de datos, la lista de endpoints con sus permisos, y el diagrama de estados de la solicitud, todo en `docs/DATA_MODEL.md`. **Después se continúa directamente con la fase 1, sin esperar confirmación.**

---

### SPEC-02 · Autenticación y sesiones — 🟣 OPUS

- Login con email y contraseña. Las contraseñas se guardan con bcrypt (coste 12 o más).
- La sesión es un JWT en una cookie `httpOnly`, `secure` y `sameSite=lax`, de corta duración, con refresh rotativo.
- `tokenVersion` en el usuario: al desactivar a alguien, cambiarle el rol o resetear su contraseña, todas sus sesiones se invalidan.
- Recuperación de contraseña por email, con un token de un solo uso que se guarda hasheado y caduca en 1 h.
- Rate limiting en login y recuperación, más `helmet`, CORS cerrado y protección CSRF si la cookie lo requiere.
- Política de contraseña mínima: al menos 10 caracteres.
- **Criterios de aceptación:** un usuario desactivado pierde el acceso en su siguiente request; los tokens no se pueden reutilizar; ninguna ruta `/api` es accesible sin sesión, salvo login, aceptar invitación, recuperación y health.

---

### SPEC-03 · Invitaciones y gestión de usuarios — 🔵 SONNET + rev. OPUS

- **Solo se entra por invitación.** El admin introduce email, nombre, rol, manager, calendario de festivos, fecha de alta, días anuales y, opcionalmente, el cumpleaños.
- Se envía un email con un enlace de token único (que se guarda hasheado) y caduca en 7 días. Al abrirlo, el usuario fija su contraseña y completa su cumpleaños si falta.
- Las invitaciones pendientes se pueden reenviar (con un token nuevo que invalida el anterior) y revocar.
- **Los usuarios no se borran**, solo se desactivan, para conservar el histórico. Al desactivar a alguien se fija `leaveDate`, se recalcula la prorrata (SPEC-07) y se muestra su **saldo de liquidación**: los días a favor o en contra para el finiquito.
- Perfil propio: nombre, avatar y contraseña. **El cumpleaños solo se puede fijar una vez**; a partir de ahí, solo lo cambia un admin (ver SPEC-11).
- Opus revisa especialmente el manejo de tokens, la enumeración de emails (las respuestas tienen que ser idénticas exista o no el email) y los permisos.

---

### SPEC-04 · Roles, permisos y árbol de empleados — 🟣 OPUS

**Roles**

- `admin`: gestiona usuarios, festivos, configuración y el árbol; ve todos los saldos; aprueba **las solicitudes de cualquier usuario** salvo las suyas (ver SPEC-10); puede hacer ajustes y anulaciones con las restricciones de SPEC-11.
- `user`: tiene su dashboard, sus solicitudes y el calendario de equipo, en el que ve fechas pero no saldos ajenos.

**Árbol de empleados**

- Cada usuario tiene un `managerId` opcional. **El manager tiene que tener el rol `admin`.**
- Validaciones:
  - No se permiten ciclos.
  - Nadie puede ser su propio manager.
  - Tiene que existir al menos un admin raíz.
  - No se puede quitar el rol de admin a alguien con reportes directos, ni desactivarlo, sin reasignarlos antes. La UI guía esa reasignación.
- Vista **Organigrama**: un árbol plegable con avatar, nombre, saldo disponible (solo para admins) e indicador de "fuera hoy". El admin puede reasignar el manager desde ahí, con confirmación y registro en auditoría.
- La vista también muestra **quién es el aprobador asignado de cada empleado** (informativo) y a quién se avisa si la solicitud se queda pendiente.

**Autorización**

- Hay un middleware de permisos por endpoint y un helper `canApprove(actor, request)` (devuelve true si el actor es admin y no es el solicitante), con tests exhaustivos.
- Cada endpoint declara su política. Hay un test que recorre todas las rutas y falla si alguna no la tiene.

---

### SPEC-05 · Festivos y calendarios — 🔵 SONNET + rev. OPUS

- Hay tres niveles, y cada uno se distingue visualmente: **nacional**, **autonómico** (Comunidad de Madrid) y **local** (municipio de Madrid).
- Importación por año desde Nager.Date con `GET https://date.nager.at/api/v3/PublicHolidays/{year}/ES`:
  - si no tiene `counties`, es nacional;
  - si `counties` incluye `ES-MD`, es autonómico de Madrid;
  - el resto se ignora.
  - Los festivos locales, como San Isidro o la Almudena, no vienen en la API y **los añade el admin a mano**.
- La importación funciona como un **borrador**: el admin ve el listado, ajusta lo que haga falta y confirma.
- El admin puede crear, editar y borrar festivos manuales. Los festivos de años cerrados se pueden consultar pero no editar.
- `HolidayCalendar` se crea por defecto como "Madrid capital" (nacional, más ES-MD, más locales de Madrid). Cada usuario tiene uno asignado.
- Hay un aviso en el dashboard del admin si el año siguiente todavía no tiene festivos importados a partir del 1 de octubre.
- ⚠️ **Lo que pasa con las solicitudes ya aprobadas cuando cambia un festivo es 🟣 OPUS y está en SPEC-11.** Sonnet solo implementa el CRUD y la importación, y llama al servicio de impacto que escribe Opus.

---

### SPEC-06 · Motor de cómputo de días — 🟣 OPUS

Es una función pura en `shared/`, sin dependencias de la base de datos:

```ts
computeRequest({ startDate, endDate, halfDay?, holidays, weekendDays: [6, 0] })
  → { days: Array<{ date, units: 0|1|2, reason?: 'weekend'|'holiday-national'|'holiday-regional'|'holiday-local' }>,
      totalUnits, calendarDays, weekendCount, holidayCount }
```

- Recorre el rango día a día, en fechas `YYYY-MM-DD` y sin tocar zonas horarias.
- Los fines de semana y festivos valen 0. Un día laborable vale 2 unidades, o 1 si es medio día.
- Un medio día solo puede caer en un día computable. Si el rango es de varios días, el medio día solo puede ser el primero o el último.
- **Las solicitudes que cruzan de año se parten por año**: cada día se descuenta del saldo del año al que pertenece.
- Devuelve el desglose que se le enseña al usuario: *"10 días naturales → 6 laborables (2 festivos, 2 fines de semana)"*.
- **Tests (los escribe Opus antes de implementar):** rangos con festivos de cada nivel, solicitudes que cruzan de año, años bisiestos, medio día en festivo (error), rangos invertidos (error), un rango de un solo día en fin de semana (0 días, error de "no computa nada"), y cambios de hora de marzo y octubre (no deben afectar).

---

### SPEC-07 · Saldo, ledger, prorrata, arrastre y caducidad — 🟣 OPUS

**Tipos de movimiento** (`ledgerEntries.type`):

`ANNUAL_ALLOWANCE` · `BIRTHDAY_ALLOWANCE` · `CARRYOVER_IN` · `CARRYOVER_EXPIRY` · `BIRTHDAY_EXPIRY` · `NEGATIVE_CARRYOVER` · `CONSUMPTION` · `REFUND` · `REALLOCATION` · `HOLIDAY_RECALC` · `ADJUSTMENT` · `PRORATION_ADJUSTMENT`

**Reglas**

- **Asignación anual:** `annualDays` del usuario, 24 por defecto, se asigna en la bolsa `CURRENT`.
- **Prorrata** por alta o baja durante el año: `annualDays × días_activos / días_del_año`, **redondeado al medio día más cercano**. Lo mismo aplica si cambia `annualDays` a mitad de año: la diferencia prorrateada se registra como `PRORATION_ADJUSTMENT`.
- **Arrastre:** al cerrar el año N, el saldo positivo de la bolsa `CURRENT` pasa a N+1 como `CARRYOVER_IN`, con caducidad el último día de febrero de N+1.
- **Saldo negativo al cerrar:** pasa a N+1 como `NEGATIVE_CARRYOVER` en la bolsa `CURRENT` (la deuda no caduca).
- **Orden de consumo:** al aprobar una solicitud, cada día cuya fecha sea **anterior o igual a la caducidad** se descuenta primero de `CARRYOVER` y después de `CURRENT`. Los días posteriores a febrero siempre se descuentan de `CURRENT`. *Los arrastrados se gastan disfrutándolos antes de que caduquen; no basta con solicitarlos antes.*
- **Reasignación:** al cerrar el año, los días de enero y febrero de N+1 ya aprobados que se cargaron a `CURRENT` se pasan a `CARRYOVER` hasta agotarlo, con un movimiento `REALLOCATION`. Así el usuario no pierde arrastrados por haber planificado con antelación.
- **Caducidad:** el 1 de marzo, el saldo que quede en `CARRYOVER` se elimina con `CARRYOVER_EXPIRY`.
- **Límite negativo:** `disponible_total − nueva_solicitud ≥ −negativeLimit` (−5 por defecto), donde `disponible_total` ya descuenta lo reservado por solicitudes pendientes. Si no se cumple, la solicitud se bloquea. Si queda en negativo pero dentro del límite, se muestra un aviso en rojo y se permite.
- **Ajustes manuales:** solo los puede hacer un admin, con motivo obligatorio y registro en auditoría. No puede ajustar su propio saldo (ver SPEC-11).
- **Los movimientos nunca se editan ni se borran**: cualquier corrección se hace con un movimiento de signo contrario.
- **Avisos de caducidad** (disclaimer):
  - Al cerrar el año se envía un email: *"Tienes X días de {año} que caducan el {28/29} de febrero. Si no los disfrutas antes de esa fecha, se perderán."*
  - En el dashboard hay un banner con cuenta atrás desde el 1 de enero hasta la caducidad; pasa a naranja con menos de 30 días y a rojo con menos de 7.
  - Se envían emails recordatorio 30 y 7 días antes.
  - En el formulario de solicitud, si hay arrastrados y la solicitud incluye días posteriores a febrero, se avisa: *"Estos días se descontarán de {año actual}, no de tus días arrastrados."*
- **Tests obligatorios:** prorrata con alta el 1 de enero, el 15 de junio y el 31 de diciembre; cierre con saldo positivo, cero y negativo; reasignación; caducidad en año bisiesto; límite exacto (−5 se permite, −5,5 se bloquea); doble gasto concurrente.

---

### SPEC-08 · Día de cumpleaños — 🟣 OPUS

- Cada año se asigna 1 día (`BIRTHDAY_ALLOWANCE`) en la bolsa `BIRTHDAY`. **No se arrastra**: el 31 de diciembre se elimina con `BIRTHDAY_EXPIRY` si no se ha usado.
- Se solicita con `kind: BIRTHDAY` y **pasa por aprobación** igual que las vacaciones.
- **Regla de fecha:**
  - Si el cumpleaños cae en un día laborable, el día de libre es el propio cumpleaños.
  - **Si cae en fin de semana o festivo, el usuario lo puede mover** a otro día laborable dentro de una ventana configurable, por defecto el mismo mes. Ver decisiones abiertas.
- No admite medio día. El 29 de febrero se trata como 28 de febrero en los años no bisiestos.
- Tiene su propio color en todas las vistas, incluida la fecha del cumpleaños como marca aunque no se haya pedido el día.
- Si el usuario entra después de su cumpleaños en el año de alta, ese año no le corresponde el día.

---

### SPEC-09 · Solicitudes y máquina de estados — 🟣 OPUS

**Crear una solicitud**

- Puede ser un rango (inicio y fin), un solo día o un medio día (mañana o tarde).
- Antes de enviarla, se muestra la previsualización del cómputo (SPEC-06): cuántos días computan, de qué bolsa salen y el saldo resultante.
- Comentario opcional.
- **Validaciones en servidor:**
  - `startDate ≥ hoy`: un usuario no puede pedir días en el pasado.
  - `endDate ≤ 31 de diciembre del año siguiente`.
  - Al menos un día computable.
  - No puede solaparse con otra solicitud propia pendiente o aprobada.
  - Tiene que respetar el límite de saldo (SPEC-07).
- Hay un aviso informativo de solape con el equipo: *"Ese día ya hay N personas fuera de tu equipo."* No bloquea.

**Estados**

```
PENDING ──aprobar──▶ APPROVED ──cancelar (usuario, antes de iniciar)──▶ CANCELLED (+REFUND)
   │                    └──anular (admin, con warning)──────────────▶ REVOKED  (+REFUND parcial o total)
   ├──rechazar (motivo obligatorio)──▶ REJECTED
   └──cancelar (usuario)────────────▶ CANCELLED
```

- **Modificar** una solicitud no es editarla: se crea una nueva solicitud con `replacesRequestId`. La original sigue aprobada hasta que se aprueba la nueva; en ese momento, de forma atómica, la original pasa a `CANCELLED` con su `REFUND` y la nueva consume sus días. Si la nueva se rechaza, la original se mantiene.
- Si una solicitud sigue pendiente cuando llega su `startDate`, se marca como **urgente** y se escala (SPEC-10). Se puede aprobar después de iniciada, pero con un aviso.
- Todas las transiciones se hacen con una actualización condicional sobre el estado (`{_id, status: 'PENDING'}`), para que no haya dobles aprobaciones.

---

### SPEC-10 · Aprobaciones y enrutado por árbol — 🟣 OPUS

- **Aprobador principal:** el manager directo del solicitante (`managerId`).
- **Quién puede aprobar:** cualquier ancestro del solicitante en el árbol. Los admins que no están en su cadena ven la solicitud pero no pueden aprobarla.
- **Escalado automático** al manager del manager (notificación in-app y email) cuando:
  - la solicitud lleva más de 48 h pendiente (configurable), o
  - el manager directo está de vacaciones aprobadas el día en que llega la solicitud, o
  - la solicitud se ha vuelto urgente (SPEC-09).
- **Un admin raíz (sin manager)** necesita la aprobación de cualquier otro admin raíz. Si es el único admin, su solicitud se **autoaprueba** y queda marcada en auditoría como `AUTO_APPROVED_NO_APPROVER`, visible en el panel.
- **Nadie aprueba sus propias solicitudes**, en ningún caso.
- Al aprobar, **se revalida el saldo** en ese momento, porque puede haber cambiado desde que se envió la solicitud. Si ya no cabe, la aprobación se bloquea y se explica por qué.
- Rechazar exige un motivo, que el usuario ve.
- La aprobación rápida se puede hacer desde el email (enlace firmado que lleva a la app con sesión; **nunca se aprueba solo con hacer clic en el email**) y desde el dashboard del admin.

---

### SPEC-11 · Control anti-trampas — 🟣 OPUS

Opus diseña e implementa **todas** estas reglas, más la lista de eventos de auditoría (SPEC-12).

**Pasado e iniciado**

1. **El usuario no puede cancelar ni modificar nada que ya ha empezado** (`startDate ≤ hoy`), ni siquiera los días que quedan de un rango en curso.
2. **Solo un admin** puede anular una solicitud iniciada o pasada (`REVOKED`), total o parcialmente (desde una fecha concreta), y con estas condiciones:
   - un **modal de aviso destacado** que muestra el impacto en el saldo, con el texto *"Esta solicitud ya se ha disfrutado total o parcialmente. Anularla devolverá X días al saldo de {usuario}."*;
   - un **motivo obligatorio**;
   - escribir `ANULAR` para confirmar;
   - registro en auditoría y notificación al usuario y a su manager.
3. **El usuario no puede pedir días en el pasado.** Solo un admin puede hacer un **registro retroactivo** (por ejemplo, de alguien que se olvidó de pedirlo), con el mismo aviso, motivo y auditoría.

**Conflictos de interés**

4. Un admin **no puede aprobar, anular ni ajustar sus propias solicitudes o su propio saldo**, ni cambiar su propio manager, sus días anuales o su fecha de alta. Todo eso lo tiene que hacer otro admin.
5. El **cumpleaños solo lo fija el usuario una vez**. A partir de ahí, solo lo cambia un admin, con motivo y auditoría. Así se evita mover el cumpleaños para cobrar el día dos veces. Además, solo puede haber un día de cumpleaños por año, aunque cambie la fecha.

**Integridad de datos**

6. El ledger solo admite inserciones: ni editar ni borrar movimientos. Los años cerrados quedan congelados.
7. **Todo el cómputo se hace en el servidor**: el servidor ignora cualquier número de días que envíe el cliente.
8. El límite negativo tiene en cuenta los días reservados por solicitudes pendientes, para que no se pueda superar enviando varias solicitudes a la vez. La protección contra el doble gasto concurrente está en SPEC-01.
9. Al aprobar, se revalida el saldo (SPEC-10).

**Cambios de festivos sobre solicitudes aprobadas**

10. Si un admin crea, borra o mueve un festivo que afecta a solicitudes aprobadas, se le muestra **la lista de solicitudes y usuarios afectados y el impacto en días** antes de confirmar. Al confirmar, se generan movimientos `HOLIDAY_RECALC` (positivos o negativos) y se notifica a los afectados. Si afecta a días ya disfrutados, aparece el mismo aviso destacado del punto 2.

**Trazabilidad**

11. Cada acción sensible se guarda en `auditLogs` con el estado anterior y el posterior. Esto incluye aprobar, rechazar, anular, hacer un registro retroactivo, hacer un ajuste, cambiar días anuales, alta o baja, cambiar el cumpleaños, el manager o el rol, cambiar festivos, cambiar la configuración y las autoaprobaciones.
12. Hay una vista **"Actividad sensible"** en el panel de admin, con filtros, que muestra las anulaciones de días pasados, los registros retroactivos, los ajustes y las autoaprobaciones.

**Tests:** un test por regla, que compruebe que la API devuelve 403 o 422 incluso si se llama directamente, saltándose la UI.

---

### SPEC-12 · Auditoría — 🔵 SONNET + rev. OPUS

- Un servicio `audit.log(actor, action, target, before, after, reason)` que se llama desde los servicios de dominio, no desde los controladores.
- Una vista de admin con filtros por usuario, acción y fechas, y exportación a CSV.
- Los logs no se pueden editar ni borrar desde la app.
- Opus revisa que todas las acciones de SPEC-11 punto 11 quedan registradas, con un test que lo compruebe.

---

### SPEC-13 · Notificaciones (email e in-app) — 🔵 SONNET + rev. OPUS

| Evento | Destinatarios | Canal |
|---|---|---|
| Nueva solicitud | Manager directo | Email e in-app |
| Escalado | Manager del manager | Email e in-app |
| Solicitud aprobada, rechazada o anulada | Solicitante (y su manager si la anula otro admin) | Email e in-app |
| Cambio de festivo que afecta a solicitudes | Usuarios afectados | Email e in-app |
| Ajuste manual de saldo | Usuario afectado | In-app |
| Arrastrados a punto de caducar (30 y 7 días antes) | Usuario | Email e in-app |
| Cierre de año (resumen y disclaimer) | Cada usuario | Email |
| Solicitudes pendientes de más de 48 h (resumen diario a las 9:00) | Aprobadores | Email |

- Campana in-app con un contador de no leídas y la opción "marcar todas como leídas".
- Plantillas de email en español, con un tono cercano y un diseño simple y consistente.
- Si falla el envío de un email, no se rompe la operación: se usa una cola en Mongo con reintentos.

---

### SPEC-14 · Tareas programadas — 🟣 OPUS

Todas son **idempotentes**: si se ejecutan dos veces, el resultado es el mismo, gracias a `idempotencyKey`. Usan `timezone: 'Europe/Madrid'`, dejan registro de cada ejecución y el admin las puede lanzar a mano.

| Job | Cuándo | Qué hace |
|---|---|---|
| Cierre de año | 1 de enero, 00:10 | Cierra el año N: genera arrastre o negativo, asignaciones de N+1 (anual y cumpleaños), caducidad del cumpleaños de N y reasignación de enero y febrero; marca `userYears.closed`; envía los emails de resumen |
| Caducidad de arrastrados | 1 de marzo, 00:10 | `CARRYOVER_EXPIRY` del saldo restante |
| Avisos de caducidad | Diario, 09:00 | Avisos a 30 y 7 días |
| Escalado y recordatorios | Cada hora / diario, 09:00 | Escalado de solicitudes con más de 48 h y resumen a los aprobadores |
| Festivos del próximo año | 1 de octubre | Avisa al admin si faltan los festivos del año siguiente |

- Si el servidor estaba caído a la hora programada, el job **recupera al arrancar** lo que no se ejecutó (catch-up).
- Railway puede tener varias réplicas: hay que usar un **lock distribuido en Mongo** para que cada job corra una sola vez.
- **Tests:** simular el cierre con un reloj inyectable; ejecutarlo dos veces; ejecutarlo con el servidor caído el día 1 y arrancado el día 3.

---

### SPEC-15 · Dashboard del usuario — 🔵 SONNET + rev. OPUS

- **Tarjetas de KPI:**
  - Disponibles del año
  - **Arrastrados**, con su propio color, la fecha de caducidad y una cuenta atrás
  - **Cumpleaños**: disponible, solicitado o disfrutado, y la fecha
  - Disfrutados
  - Pendientes de aprobar
  - **Saldo total**, en rojo si es negativo, con el límite visible
- El banner de caducidad de SPEC-07.
- Próximas vacaciones y el historial de solicitudes con su estado. Se pueden filtrar y desde ahí se cancela o modifica cuando está permitido.
- Un botón grande de "Solicitar vacaciones", con un selector de rango y la previsualización del cómputo en tiempo real.
- Un widget de "Quién está fuera hoy y esta semana".

---

### SPEC-16 · Vista anual compacta y vista mensual — 🔵 SONNET + rev. OPUS

- **Vista anual:** los 12 meses en una cuadrícula de mini-calendarios en una sola pantalla, con los días coloreados según la leyenda de SPEC-19. Se puede navegar por años y un admin la puede ver para cualquier usuario.
- **Vista mensual:** un calendario grande y navegable. Se puede **seleccionar un día o arrastrar un rango** para abrir la solicitud ya rellenada, y al pasar el ratón por un día se ve su detalle (festivo, solicitud, estado).
- Medio día: la celda aparece partida en diagonal (mañana arriba a la izquierda, tarde abajo a la derecha).
- Las solicitudes pendientes se muestran con borde o rayado, y las aprobadas con relleno sólido.
- Tiene que funcionar bien en móvil: la vista anual pasa a 2 columnas y la mensual se puede desplazar.

---

### SPEC-17 · Calendario de equipo — 🔵 SONNET + rev. OPUS

- Filas de usuarios y columnas con los días del mes, con los fines de semana y festivos sombreados.
- Filtros: todo el equipo, mi rama del árbol o los reportes de un manager.
- Una fila de totales con cuántas personas están fuera cada día, que se resalta si supera un umbral configurable.
- Los usuarios ven quién está fuera, pero no los saldos ajenos ni los comentarios.

---

### SPEC-18 · Panel de administración — 🔵 SONNET + rev. OPUS

- **Dashboard de admin:**
  - Solicitudes que me tocan aprobar, con aprobación o rechazo rápidos.
  - Escaladas.
  - Fuera hoy.
  - Avisos (festivos que faltan, autoaprobaciones, actividad sensible reciente).
- **Saldos:** una tabla con todos los usuarios y sus bolsas (actual, arrastrados, cumpleaños, reservado y total), que se puede ordenar y exportar a CSV. Desde ahí se accede a la vista anual de cada usuario.
- **Usuarios e invitaciones** (SPEC-03), **organigrama** (SPEC-04), **festivos** (SPEC-05) y **configuración** (valores de la sección 0).
- **Ajuste de saldo:** un formulario con la bolsa, los días (±, en múltiplos de 0,5) y el motivo obligatorio, que muestra el saldo antes y después.
- Todas las acciones peligrosas usan el componente de aviso de SPEC-11 punto 2.

---

### SPEC-19 · Sistema visual y leyenda de colores — 🔵 SONNET + rev. OPUS

Un único archivo de tokens de color (`shared/colors.ts`) que se usa en todas las vistas y en una leyenda siempre visible:

| Elemento | Tratamiento |
|---|---|
| Vacaciones aprobadas (año actual) | Color primario, relleno sólido |
| Vacaciones consumidas de arrastrados | **Un tono distinto** del primario |
| Pendiente de aprobar | Borde o rayado del color correspondiente |
| Día de cumpleaños | Color propio, con un icono 🎂 |
| Medio día | Celda partida en diagonal |
| Festivo nacional / autonómico / local | Tres tonos claramente distintos |
| Fin de semana | Atenuado |
| Hoy | Anillo |
| Saldo negativo | Rojo |

- El color nunca es la única señal: siempre va acompañado de un icono, un patrón o un tooltip, por accesibilidad.
- Tiene modo claro y oscuro.

---

### SPEC-20 · Seed, README y despliegue — ⚪ HAIKU / 🔵 SONNET + rev. OPUS

- **Seed** (⚪): 1 admin raíz, 2 managers, 6 usuarios en un árbol de 3 niveles, festivos de 2026 y 2027, y solicitudes de ejemplo en todos los estados, incluyendo arrastrados, un saldo negativo y un cumpleaños en fin de semana.
- **README** (⚪): instrucciones de desarrollo local, variables de entorno, scripts y cómo lanzar los jobs a mano.
- **Railway** (🔵): un único servicio para la app más MongoDB, el healthcheck, el build del monorepo, la variable `TZ=Europe/Madrid` (además de usar siempre fechas explícitas) y las migraciones o el arranque idempotente.

---

### SPEC-21 · Estrategia de tests — 🟣 OPUS / 🔵 SONNET

- 🟣 **Opus escribe primero los casos de test** de SPEC-06, 07, 08, 10, 11 y 14, **antes de implementar**, a modo de especificación ejecutable. Ninguna implementación de esas specs se da por cerrada si no pasan.
- 🔵 Sonnet escribe los tests de API del CRUD y los e2e con Playwright de los flujos clave: invitar, aceptar, solicitar, aprobar, ver el saldo, cancelar y anular como admin.
- Cobertura mínima del 90 % para `shared/engine` y los servicios de saldo y anti-trampas.

---

## 5. Protocolo de revisión de Opus

Opus revisa cada entrega de Sonnet o Haiku antes de hacer merge, y repasa la misma lista sobre su propio trabajo.

- [ ] Cumple **todos** los criterios de su spec y no inventa reglas que no están escritas.
- [ ] Las fechas de calendario son `YYYY-MM-DD`; no hay `new Date()` para "hoy" fuera de `todayMadrid()`.
- [ ] No hay lógica de negocio en el front ni en los controladores; todo está en los servicios de dominio.
- [ ] Cada endpoint nuevo declara su política de permisos y tiene un test de 403.
- [ ] Las acciones sensibles llaman a `audit.log`.
- [ ] Los saldos se tratan solo a través del ledger (en medios días) y no se mutan directamente.
- [ ] Las operaciones con varias escrituras son atómicas o idempotentes.
- [ ] Los errores devuelven mensajes claros en español; no se filtran stack traces.
- [ ] Hay tests y pasan, y no se ha borrado ni debilitado ningún test existente.
- [ ] No se han añadido dependencias innecesarias.

Si la revisión encuentra fallos en la lógica 🟣, **Opus los corrige directamente** en lugar de devolverlos.

### Cómo ejecutarlo en Claude Code (sugerencia)

- Opus 5.5 trabaja como orquestador en la sesión principal.
- Crear `.claude/agents/implementer.md` con `model: sonnet` para las specs 🔵, y `.claude/agents/mechanic.md` con `model: haiku` para las ⚪.
- Opus delega cada spec 🔵 o ⚪ con su texto completo **y con las reglas del modo autónomo (R1–R8)**. Cuando el subagente termina, Opus revisa el diff con esta checklist, corrige lo que haga falta, hace commit y sigue, sin pedir confirmación.
- Poner las "Reglas técnicas transversales" (sección 1) y la checklist en el `CLAUDE.md` de la raíz para que todos los modelos las tengan siempre presentes.

---

## 6. Fases y orden

| Fase | Specs | Depende de |
|---|---|---|
| 0. Permisos y diseño | Paso R2 + SPEC-01 (+ tests de SPEC-21 🟣) | — (sin pausa) |
| 1. Base | SPEC-02, SPEC-03, SPEC-04, SPEC-20 (esqueleto y Railway) | 0 |
| 2. Calendario | SPEC-05, SPEC-06 | 1 |
| 3. Saldos | SPEC-07, SPEC-08 | 2 |
| 4. Flujo | SPEC-09, SPEC-10, SPEC-11, SPEC-12 | 3 |
| 5. Comunicación | SPEC-13, SPEC-14 | 4 |
| 6. Vistas | SPEC-19, SPEC-15, SPEC-16, SPEC-17, SPEC-18 | 4 (se puede empezar el visual en paralelo con mocks) |
| 7. Cierre | Seed final, README, e2e y despliegue en producción | todo |

---

## 7. Fase 2 (la arquitectura debe dejarlo preparado, pero no se implementa todavía)

- Feed iCal por usuario y del equipo, para Google Calendar u Outlook.
- Exportación a Excel de saldos e historial.
- Periodos bloqueados en los que no se pueden pedir vacaciones (cierres, picos de trabajo).
- Antelación mínima para solicitar, configurable.
- Máximo de personas fuera por equipo y día, como bloqueo además del aviso.
- Aviso en noviembre a quien tenga muchos días sin gastar.
- Notificaciones por Slack.
- Varios centros de trabajo con calendarios de festivos distintos (el modelo ya lo soporta).
- Delegación temporal de aprobaciones.

**Fuera del alcance:** bajas médicas, permisos retribuidos, asuntos propios y adjuntos de justificantes.

---

## 8. Decisiones abiertas: se implementa el valor por defecto sin preguntar

Ignacio las revisará a la vuelta. Todas tienen que ser **configurables** desde Configuración cuando sea razonable, para poder cambiarlas sin tocar código.

| # | Decisión | **Valor por defecto que se implementa** | Configurable |
|---|---|---|---|
| 1 | Ventana para mover el cumpleaños si cae en fin de semana o festivo | **Cualquier día laborable del mismo mes** | Sí (mismo mes / ±N días / todo el año) |
| 2 | Límite de saldo negativo | **−5 días** | Sí |
| 3 | Tope de días arrastrados | **Sin tope** | Sí (0 = sin tope) |
| 4 | Consumo de arrastrados | Hay que **disfrutarlos** antes del último día de febrero; no basta con solicitarlos | No |
| 5 | Visibilidad del calendario de equipo | **Toda la empresa ve a toda la empresa** (fechas, no saldos) | Sí (empresa / rama) |
| 6 | Admins fuera de la cadena de aprobación | **Solo ven las solicitudes, no las aprueban** | No |
| 7 | Días anuales | **24 laborables por defecto**, editable por usuario | Sí |

Cualquier otra duda que surja durante la implementación se resuelve igual: se toma una decisión razonable y se apunta en `docs/DECISIONS.md` (R1).
