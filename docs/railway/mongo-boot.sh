#!/bin/bash
# holidayTracker — MongoDB como replica set de un nodo (necesario para transacciones).
set -euo pipefail
DB=/data/db
mkdir -p "$DB"
printf '%s' "${MONGO_KEYFILE:?}" > /tmp/mongo-keyfile
chmod 400 /tmp/mongo-keyfile
COMMON=(--replSet rs0 --dbpath "$DB" --port 27017 --setParameter diagnosticDataCollectionEnabled=false --setParameter indexBuildMinAvailableDiskSpaceMB=50 --wiredTigerCacheSizeGB 0.25)
if [ ! -f "$DB/.ht-bootstrapped" ]; then
  echo "[boot] Inicializando replica set y usuario root"
  mongod "${COMMON[@]}" --bind_ip 127.0.0.1 --fork --logpath /tmp/mongod-init.log
  mongosh --quiet --eval 'try { rs.status().ok } catch (e) { printjson(rs.initiate({_id:"rs0", members:[{_id:0, host:"localhost:27017"}]})) }'
  for i in $(seq 1 60); do
    if mongosh --quiet --eval 'db.hello().isWritablePrimary' | grep -q true; then break; fi
    sleep 1
  done
  mongosh --quiet admin --eval "if (!db.getUser('${MONGO_ROOT_USER:?}')) db.createUser({user:'${MONGO_ROOT_USER}', pwd:'${MONGO_ROOT_PASSWORD:?}', roles:['root']}); print('[boot] usuario root OK')"
  if [ -n "${BOOTSTRAP_JS_B64:-}" ]; then
    echo "$BOOTSTRAP_JS_B64" | base64 -d > /tmp/bootstrap.js
    mongosh --quiet "mongodb://127.0.0.1:27017/${APP_DB:-holidaytracker}?directConnection=true" /tmp/bootstrap.js
  fi
  mongod --dbpath "$DB" --shutdown
  touch "$DB/.ht-bootstrapped"
  echo "[boot] Inicialización terminada"
fi
exec mongod "${COMMON[@]}" --ipv6 --bind_ip ::,0.0.0.0 --keyFile /tmp/mongo-keyfile
