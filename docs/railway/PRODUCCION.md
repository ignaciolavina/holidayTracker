# holidayTracker en Railway (producción)

Desplegado el 27-10-2026 en el proyecto de Railway **lifeboard** (entorno `production`), como dos servicios nuevos e independientes de lifeboard y de su MongoDB:

| Servicio | Qué es |
|---|---|
| `holidaytracker` | La app (API + front). Se despliega desde el repo `ignaciolavina/holidayTracker`, rama `main`. URL: https://holidaytracker-production-5d7f.up.railway.app |
| `holidaytracker-mongo` | MongoDB 8.0 como **replica set de un nodo** (`rs0`), con autenticación (keyFile + usuario root) y un volumen en `/data/db`. Solo se puede acceder por la red privada: `holidaytracker-mongo.railway.internal:27017` |

## MongoDB

- Imagen `mongo:8.0`. El comando de arranque decodifica y ejecuta el script que está en la variable `BOOT_SH_B64`. Hay una copia de ese script en `mongo-boot.sh`, en esta misma carpeta.
- **En el primer arranque**, el script hace lo siguiente:
  1. Inicializa el replica set.
  2. Crea el usuario root (`MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD`).
  3. Ejecuta `BOOTSTRAP_JS_B64`, que crea el calendario "Madrid capital", los festivos de 2026 y 2027, y el admin inicial `ignacio@bemycar.pro` en estado *invitado*.

  Al terminar deja la marca `/data/db/.ht-bootstrapped`, así que en los arranques siguientes no repite nada de esto.
- Parámetros que se han añadido:
  - `indexBuildMinAvailableDiskSpaceMB=50`: el volumen es pequeño (unos 434 MB) y, sin este parámetro, Mongo se niega a crear índices.
  - `wiredTigerCacheSizeGB=0.25`: limita el uso de memoria.
- El replica set se anuncia como `localhost:27017`, por eso la app se conecta con `directConnection=true`. Las transacciones funcionan; está comprobado.
- Las credenciales están solo en las variables del servicio. No se han guardado en el repo.

## App

- `MONGODB_URI` está construida con referencias de Railway a las variables del servicio de Mongo (`${{holidaytracker-mongo.*}}`).
- `APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}`
- `NODE_ENV=production`, `SEED_ON_EMPTY=false`, `TZ=Europe/Madrid`, `CRON_ENABLED=true`
- `MAIL_TRANSPORT=console`: **de momento no se envía ningún email**.
- Variables que hacen falta para que funcione la build:
  - `NIXPACKS_NO_CACHE=1`: el `buildCommand` de `railway.json` (`npm ci && npm run build`) choca con la caché de Nixpacks y falla con `EBUSY` en `node_modules/.cache`.
  - `NPM_CONFIG_INCLUDE=dev`: con `NODE_ENV=production`, `npm ci` no instala las devDependencies (vite, tsup…) y la build falla.
  - `MONGOMS_DISABLE_POSTINSTALL=1`: evita que se descargue el binario de mongodb-memory-server durante la build.
- Arreglo recomendado en el repo: cambiar el `buildCommand` de `railway.json` a `npm run build`. Con eso ya no haría falta `NIXPACKS_NO_CACHE`.

## Pendiente

1. **Emails.** Railway Hobby bloquea el SMTP saliente. Hay dos opciones:
   - Resend, que ya está programado: `MAIL_TRANSPORT=resend`, `RESEND_API_KEY` y un `MAIL_FROM` con dominio verificado.
   - Añadir un transporte para la API HTTP de SendGrid.

   Mientras no esté configurado, las invitaciones no llegan por correo.
2. **Autodeploy.** El servicio está enganchado al repo público. Si al hacer push a `main` no se despliega solo, hay que dar acceso al repo a la GitHub App de Railway, o lanzar el deploy a mano desde Railway.
3. **Fecha de alta del admin inicial.** Es `2026-01-01`. Si no es correcta, la tiene que cambiar otro admin (las reglas anti-trampas impiden que un admin edite la suya).
