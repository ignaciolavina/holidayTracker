# holidayTracker — Informe de entrega (R8)

Ejecución autónoma del 26-27 de octubre de 2026. Opus 5.5 ha orquestado el trabajo y ha escrito el backend 🟣. Sonnet 5.5 ha hecho el frontend, los e2e y la configuración de Railway. Haiku 5.5 ha hecho el seed y el README. Opus ha revisado todo lo de Sonnet y Haiku antes de cada commit.

## 1. Estado por spec

| Spec | Módulo | Estado | Commit |
|---|---|---|---|
| SPEC-01 | Arquitectura y modelo de datos (`docs/DATA_MODEL.md`, transacciones con replica set) | ✅ | `dfbdc32`, `49b6ee8` |
| SPEC-02 | Autenticación y sesiones (JWT en cookie, refresh rotativo con detección de reutilización, tokenVersion, recuperación, rate limit, helmet, CSRF) | ✅ | `49b6ee8` |
| SPEC-03 | Invitaciones y gestión de usuarios (baja con prorrata y saldo de liquidación) | ✅ | `49b6ee8`, `949c1d3` |
| SPEC-04 | Roles, permisos y árbol (política declarada por endpoint con test, `canApprove`, organigrama) | ✅ | `49b6ee8`, `ea9cff4` |
| SPEC-05 | Festivos (3 niveles, importación de Nager.Date como borrador, CRUD) | ✅ | `49b6ee8`, `949c1d3` |
| SPEC-06 | Motor de cómputo de días (`shared/src/engine`) | ✅ | `dfbdc32`, `49b6ee8` |
| SPEC-07 | Saldo, ledger, prorrata, arrastre, reasignación y caducidad | ✅ | `49b6ee8` |
| SPEC-08 | Día de cumpleaños | ✅ | `49b6ee8` |
| SPEC-09 | Solicitudes y máquina de estados (modificar = sustituir, urgentes) | ✅ | `49b6ee8` |
| SPEC-10 | Aprobaciones, escalado, autoaprobación, enlace firmado | ✅ | `49b6ee8` |
| SPEC-11 | Anti-trampas (un test por regla, contra la API directamente) | ✅ | `49b6ee8` |
| SPEC-12 | Auditoría (servicio, vista con filtros, actividad sensible, CSV) | ✅ | `49b6ee8`, `949c1d3` |
| SPEC-13 | Notificaciones (in-app + email con cola y reintentos) | ✅ | `49b6ee8` |
| SPEC-14 | Tareas programadas (idempotentes, lock distribuido, catch-up, ejecución manual) | ✅ | `49b6ee8` |
| SPEC-15 | Dashboard del usuario | ✅ | `949c1d3` |
| SPEC-16 | Vista anual y mensual | ✅ | `949c1d3` |
| SPEC-17 | Calendario de equipo | ✅ | `949c1d3` |
| SPEC-18 | Panel de administración | ✅ | `949c1d3`, `ea9cff4` |
| SPEC-19 | Sistema visual y leyenda (`shared/src/colors.ts`, claro/oscuro) | ✅ | `949c1d3` |
| SPEC-20 | Seed, README y configuración de Railway | ✅ (sin desplegar, como exige R5) | `299c5cf`, `937fd14`, `d5293e4`, `956bbff` |
| SPEC-21 | Estrategia de tests | ✅ | `49b6ee8`, `ea9cff4`, `d5293e4` |

**No hay commits por spec, sino por fase.** Es una desviación consciente de R4: las specs 🟣 se llaman entre sí, y un commit por spec habría dejado estados intermedios que no compilan. Está apuntado en DECISIONS. Cada commit deja los tests en verde.

## 2. Tests y cobertura

- **Unitarios + API (Vitest):** `npm test` da **132 de 132 en verde** en 8 archivos, y tarda unos 3 minutos.
  - `shared/src/engine/*.test.ts`: motor, prorrata, bolsas, límites y cumpleaños, escritos antes de implementar.
  - `server/test/requests.test.ts`: SPEC-09 y SPEC-10.
  - `server/test/balance.test.ts`: SPEC-07, SPEC-08 y SPEC-14. Cubre prorrata el 1-1, el 15-6 y el 31-12; cierre con saldo positivo, cero y negativo; reasignación; caducidad en año bisiesto; límite −5 permitido y −5,5 bloqueado; doble gasto concurrente; cierre ejecutado dos veces; catch-up con el servidor caído el día 1 y arrancado el día 3.
  - `server/test/antiCheat.test.ts`: SPEC-11, un test por regla con 403/422.
  - `server/test/auth.test.ts`: SPEC-02, SPEC-03, SPEC-04 y SPEC-12. Un test recorre todas las rutas y falla si alguna no tiene política, y comprueba los 401/403.
  - `server/test/policies.test.ts` y `server/test/seed.test.ts`.
- **e2e (Playwright):** `npm run test:e2e` da **8 de 8 en verde** (unos 35 s, build incluido). Cubre login y logout, invitar y aceptar, solicitar con previsualización, aprobar, ver saldo y vista anual, cancelar, y anular como admin.
- **Cobertura** (`npm run test:coverage`, sobre motor + servicios de saldo + anti-trampas): **98,2 % de líneas** y 83 % de ramas.

  | Ámbito | Líneas | Ramas |
  |---|---|---|
  | `shared/src/engine` | 100 % | 91,9 % |
  | `services/balance` | 97,3 % | 74,1 % |
  | `services/antiCheat` | 100 % | 100 % |

  Se cumple el mínimo del 90 % en líneas. Las ramas de `services/balance` están por debajo: son sobre todo casos defensivos (años no abiertos, usuarios sin alta en el año).
- `npm run lint` y `npm run typecheck` pasan sin errores. `npm run build` funciona.

## 3. Decisiones y bloqueos

**Bloqueos:** ninguno (`docs/BLOCKERS.md` está vacío).

**Decisiones:** hay 30 en `docs/DECISIONS.md`. Las que más conviene revisar:
1. **Quién aprueba.** La spec se contradice: la sección 0 y SPEC-04 dicen "cualquier admin" y SPEC-10 y la decisión 6 dicen "solo la cadena". Lo he hecho configurable con `approvalPolicy`. Por defecto es `any_admin`, y el manager directo aparece como aprobador asignado a nivel informativo. `chain` está disponible en Configuración.
2. **Apertura de años.** El derecho de un año se asigna en el alta, en el cierre anual o la primera vez que alguien pide días de ese año. Así se pueden validar solicitudes del año siguiente contra el ledger.
3. **Revalidación al aprobar.** Solo cuenta lo ya aprobado, no las reservas de otras pendientes.
4. **Devoluciones.** Si se anula algo de un año cerrado, los días vuelven al año abierto. Si eran arrastrados ya caducados, vuelven a CURRENT.
5. **Confirmaciones escritas.** El registro retroactivo se confirma escribiendo `REGISTRAR` y la anulación con `ANULAR`. Los cambios de festivos que afectan a días ya disfrutados piden `CONFIRMAR` y un motivo.
6. **Cancelar.** El usuario tampoco puede cancelar una solicitud pendiente que ya ha empezado (regla 1).
7. **Baja.** Al desactivar a alguien, sus solicitudes posteriores a la baja se cancelan y los días se devuelven.
8. **Cambio de calendario.** Cambiar el calendario de festivos de un usuario no recalcula lo que ya tiene aprobado.
9. **Reparto de trabajo.** Parte del backend 🔵 (CRUD de usuarios, importación de festivos, consultas de auditoría y notificaciones) la escribió Opus porque estaba muy acoplada a la lógica 🟣. Todo el frontend es de Sonnet.
10. **Navegador de los e2e.** Usan Chromium completo (`channel: 'chromium'`), porque el headless-shell falla en macOS.

**Bugs encontrados y corregidos:**
- Un deadlock de transacciones con `userYears`.
- `createdAt` no usaba el reloj inyectable.
- El JWT se firmaba con la hora real en lugar del reloj.
- En el front, tras el login no aparecía el usuario hasta recargar (lo arregló Sonnet en los e2e).

## 4. Cómo arrancarlo

```bash
npm install && npm run dev
```

- API en http://localhost:3000. Si no hay `MONGODB_URI`, usa MongoDB en memoria como replica set y carga el seed automáticamente si la base de datos está vacía.
- App en http://localhost:5173.
- Los emails se escriben en el log y en `server/tmp/mails/`.

Usuarios del seed. **Contraseña común: `vacaciones2026`**

| Email | Nombre | Rol | Notas |
|---|---|---|---|
| ana.admin@holidaytracker.local | Ana Directora | admin raíz | |
| bruno.manager@holidaytracker.local | Bruno Manager | admin (manager) | |
| carla.manager@holidaytracker.local | Carla Manager | admin (manager) | tiene una solicitud pendiente |
| diego.ruiz@holidaytracker.local | Diego Ruiz | user (de Bruno) | cumpleaños en sábado, movido al lunes; solicitudes cancelada y anulada |
| marta.sanchez@holidaytracker.local | Marta Sánchez | user (de Bruno) | arrastró 10 días de 2025 y los gastó en febrero; tiene medio día |
| javier.lopez@holidaytracker.local | Javier López | user (de Bruno) | alta el 15-06-2026 (prorrata) |
| lucia.fernandez@holidaytracker.local | Lucía Fernández | user (de Carla) | sin cumpleaños; tiene una rechazada |
| pablo.martin@holidaytracker.local | Pablo Martín | user (de Carla) | terminó 2025 con −2 días (deuda) |
| sara.gomez@holidaytracker.local | Sara Gómez | user (de Carla) | |

Para reiniciar los datos: `npm run seed -- --force`, o reiniciar `npm run dev`, porque la base de datos en memoria se pierde.

## 5. Qué falta para desplegar en Railway

La guía detallada está en `docs/DEPLOY.md`. La configuración ya está en `railway.json` y `.env.example`. **No se ha desplegado nada**, porque R5 lo prohíbe.

1. **MongoDB tiene que ser un replica set**, porque la app usa transacciones. Hay dos opciones:
   - MongoDB Atlas (lo más sencillo).
   - El Mongo de Railway arrancado con `--replSet rs0` y después `rs.initiate()`.

   Sin replica set, crear o aprobar solicitudes falla.
2. Un servicio con la app desde este repo, que usa `railway.json`: build `npm ci && npm run build`, start `npm start` y healthcheck `/api/health`.
3. Variables de entorno:
   - Obligatorias: `NODE_ENV=production`, `MONGODB_URI` y `JWT_SECRET` (aleatorio, 32 caracteres o más). Sin `MONGODB_URI` ni `JWT_SECRET` la app no arranca.
   - Recomendadas: `APP_URL` (la URL pública, se usa en los enlaces de los emails), `TZ=Europe/Madrid` y `SEED_ON_EMPTY=false`.
   - Email:
     - Resend: `MAIL_TRANSPORT=resend`, `RESEND_API_KEY` y `MAIL_FROM` con un dominio verificado.
     - SMTP: `MAIL_TRANSPORT=smtp` y las variables `SMTP_*`.
   - Opcional: `COOKIE_SECURE` (por defecto `true` en producción).
4. Tras el primer despliegue:
   - Crear el primer admin. No hay seed en producción: la vía prevista es arrancar una vez con `SEED_ON_EMPTY=true` y cambiar después las contraseñas, o insertar el admin a mano. **Esto falta por resolver:** convendría un script `create-admin`.
   - Importar los festivos del año desde Administración → Festivos y añadir los locales.
5. Los jobs (cierre de año, caducidad, avisos y escalado) corren dentro del propio servicio con `node-cron` y un lock en Mongo. Funcionan aunque haya varias réplicas.

## 6. Limitaciones conocidas

- Los transportes `smtp` y `resend` no se han probado contra un servidor real. Solo se ha usado `console`.
- **La UI se ha comprobado con los e2e y con el build.** No he revisado visualmente cada pantalla (modo oscuro y móvil incluidos).
- `npm run job` sin `MONGODB_URI` arranca una base de datos en memoria vacía. Para lanzar jobs sobre datos reales hay que apuntarlo a la misma base de datos, o usar Administración → Jobs.
- El aviso del dashboard sobre días arrastrados solo mira el saldo del año en curso.
- La fase 2 (iCal, Excel, periodos bloqueados, Slack…) no está implementada, como indica la spec. El modelo la deja preparada (`docs/DATA_MODEL.md` §7).
