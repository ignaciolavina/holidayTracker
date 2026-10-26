# holidayTracker — reglas para todos los modelos

La especificación completa está en `SPECS.md`. El modelo de datos y el contrato de la API en `docs/DATA_MODEL.md`.
Los tipos del contrato HTTP viven en `shared/src/api.ts`.

## Modo autónomo (R1–R8 de SPECS.md)
- Nunca preguntes ni pidas confirmación. Ante una duda, decide lo más razonable y apúntalo en `docs/DECISIONS.md`
  con el formato `fecha · spec · decisión · alternativas descartadas · por qué`.
- Solo comandos de la lista `allow` de `.claude/settings.json`. Nada de `git push`, remotos, Railway, `sudo`, `brew`, `npm -g`.
- No leas ni escribas fuera de esta carpeta. No envíes emails reales (transporte `console`).
- Si algo falla tras 3 intentos: apúntalo en `docs/BLOCKERS.md` y sigue con otra cosa. No debilites ni borres tests.

## Reglas técnicas transversales (no negociables)
1. Fechas de calendario como string `YYYY-MM-DD` (cumpleaños `MM-DD`). Instantes (`createdAt`…) como `Date` UTC.
2. "Hoy" = `todayMadrid()` (servidor: `clock.today()` en `server/src/lib/clock.ts`). Prohibido `new Date()` / `Date.now()` sueltos.
3. Saldos en enteros de **medios días** (24 días = 48 unidades). Solo se convierten a días al mostrarlos.
4. El saldo se calcula a partir del ledger (`ledgerEntries`), que solo admite inserciones.
5. Toda la lógica de negocio en servicios de dominio del servidor. El front solo envía fechas; nunca "cuántos días son".

## Checklist de revisión (sección 5)
- [ ] Cumple todos los criterios de su spec y no inventa reglas.
- [ ] Fechas `YYYY-MM-DD`; nada de `new Date()` para "hoy".
- [ ] Sin lógica de negocio en front ni controladores.
- [ ] Cada endpoint declara su política de permisos y tiene test de 403.
- [ ] Acciones sensibles llaman a `audit.log`.
- [ ] Saldos solo vía ledger (medios días).
- [ ] Operaciones con varias escrituras atómicas o idempotentes.
- [ ] Errores con mensajes claros en español; sin stack traces.
- [ ] Tests pasan; ninguno borrado o debilitado.
- [ ] Sin dependencias innecesarias.

## Comandos
- `npm run dev` (server :3000 + Vite :5173, Mongo en memoria si no hay `MONGODB_URI`)
- `npm test` · `npm run test:coverage` · `npm run test:e2e` · `npm run lint` · `npm run typecheck` · `npm run build`
