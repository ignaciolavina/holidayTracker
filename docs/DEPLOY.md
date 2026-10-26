# Despliegue en Railway

Un único servicio **app** (Node: API + front estático) y un servicio **MongoDB**. La configuración de build y arranque está en `railway.json`:
build `npm ci && npm run build`, arranque `npm start` (`node server/dist/index.js`, que sirve `client/dist`), healthcheck `/api/health` y reinicio `ON_FAILURE`.

## 1. MongoDB: debe ser replica set

La app usa **transacciones** (saldos, ledger, aprobaciones), que MongoDB solo permite en un replica set. Un Mongo standalone no sirve. Opciones:

**A) MongoDB Atlas** (recomendada, ya es replica set): crea un cluster, un usuario y permite la IP/0.0.0.0/0 de Railway. Usa la cadena `mongodb+srv://...` como `MONGODB_URI`.

**B) Servicio MongoDB en Railway** como replica set de un nodo:
1. Crea un servicio desde la imagen `mongo:7` con volumen en `/data/db`.
2. Comando de arranque: `mongod --replSet rs0 --bind_ip_all` (si usas autenticación, añade un `--keyFile` y variables `MONGO_INITDB_ROOT_*`).
3. Inicializa el replica set **una sola vez** abriendo una shell en el servicio: `mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"mongo.railway.internal:27017"}]})'` (el host es el nombre privado del servicio).
4. `MONGODB_URI=mongodb://mongo.railway.internal:27017/holidaytracker?replicaSet=rs0` (con usuario/clave si procede; usa la red privada, no el proxy público).

## 2. Variables del servicio app

| Variable | Valor en producción |
|---|---|
| `NODE_ENV` | `production` (obligatorio: exige `JWT_SECRET` y `MONGODB_URI` y falla al arrancar si faltan) |
| `MONGODB_URI` | cadena del replica set (ver arriba) |
| `JWT_SECRET` | cadena aleatoria de 48+ bytes |
| `APP_URL` | URL pública (`https://tu-app.up.railway.app` o dominio propio), sin barra final |
| `COOKIE_SECURE` | `true` (por defecto ya lo es en producción) |
| `CORS_ORIGIN` | vacío (el front lo sirve el mismo servidor) |
| `SEED_ON_EMPTY` | **`false`** |
| `MAIL_TRANSPORT`, `MAIL_FROM` | `smtp` o `resend` con `SMTP_*` / `RESEND_API_KEY`; `console` solo para pruebas |
| `CRON_ENABLED`, `RATE_LIMIT_ENABLED` | `true` |
| `TZ` | `Europe/Madrid` |
| `NAGER_BASE_URL` | opcional (por defecto `https://date.nager.at`) |

No definas `PORT`: Railway lo inyecta. La lista completa y comentada está en `.env.example`.

## 3. Zona horaria

Define `TZ=Europe/Madrid` en el servicio. El servidor también lo fuerza al arrancar si no está definido, pero conviene fijarlo para los logs y los jobs. Las fechas de calendario son strings `YYYY-MM-DD` y "hoy" siempre se calcula en Madrid.

## 4. Healthcheck

`/api/health` responde `{"ok":true,"db":"up"}` cuando el servidor y la base de datos están disponibles. Railway lo usa en cada despliegue (`healthcheckPath`) y no enruta tráfico a la versión nueva hasta que responde 200.

## 5. Arranque idempotente

- Los índices se crean automáticamente al conectar (`autoIndex` + `Model.init()`); reiniciar o escalar no duplica nada.
- El **seed** solo se ejecuta si `SEED_ON_EMPTY=true` **y** la base de datos está vacía. En producción déjalo en `false` y crea el primer administrador manualmente o ejecutando una vez el seed contra una base vacía con `SEED_ON_EMPTY=true`, desactivándolo después.
- Los **jobs** (cierre anual, caducidades, recordatorios, escalado) son idempotentes y usan un **lock distribuido** en Mongo (`jobLocks`): con varias réplicas solo una ejecuta cada job; las demás lo omiten. Al arrancar se ejecuta un catch-up de los jobs que se hayan perdido durante una caída.

## 6. Pasos

1. Crea el proyecto en Railway y conecta el repositorio (el servicio detecta `railway.json`).
2. Crea la base de datos (Atlas o servicio Mongo con replica set) y copia la cadena de conexión.
3. Define las variables de la sección 2.
4. Despliega. Comprueba `https://<tu-app>/api/health`.
5. Entra con el administrador inicial y configura calendarios de festivos, usuarios e invitaciones.

## 7. Comprobación local equivalente

```bash
npm ci && npm run build
NODE_ENV=production MONGODB_URI='mongodb://localhost:27017/ht?replicaSet=rs0' JWT_SECRET=$(openssl rand -hex 32) \
  SEED_ON_EMPTY=false APP_URL=http://localhost:3000 COOKIE_SECURE=false npm start
```

Sin `JWT_SECRET` o sin `MONGODB_URI` en `production`, el proceso aborta de inmediato con un error claro.
