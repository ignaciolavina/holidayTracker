import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../db/connect';
import { runSeed, seedIfEmpty, SEED_PASSWORD, SEED_USERS } from './seedData';

/**
 * Uso: npm run seed            → crea el seed solo si la base de datos está vacía
 *      npm run seed -- --force → borra la base de datos y vuelve a crear el seed
 */
async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  await connectDb();
  try {
    if (force) {
      await mongoose.connection.db!.dropDatabase();
      await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
      await runSeed();
      console.log('Base de datos reiniciada y seed creado.');
    } else if (await seedIfEmpty()) {
      console.log('Seed creado.');
    } else {
      console.log('La base de datos ya tiene usuarios: no se ha modificado (usa --force para reiniciarla).');
    }
    console.log(`Contraseña común: ${SEED_PASSWORD}`);
    console.log('Usuarios:');
    for (const u of SEED_USERS) console.log(`  [${u.role}] ${u.email} · ${u.name}`);
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
