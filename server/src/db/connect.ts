import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from '../lib/logger';

let memory: { stop: () => Promise<unknown> } | null = null;

/**
 * Conecta a MONGODB_URI o, si no está definido (desarrollo), arranca un MongoMemoryReplSet de un nodo
 * para poder usar transacciones (R6).
 */
export async function connectDb(uri = env.mongodbUri, dbName?: string): Promise<void> {
  let target = uri;
  if (!target) {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    memory = rs;
    target = rs.getUri();
    logger.info('MongoDB en memoria (replica set) arrancado');
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(target, { dbName, autoIndex: true });
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  if (memory) await memory.stop();
  memory = null;
}
