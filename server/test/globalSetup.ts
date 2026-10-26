import { MongoMemoryReplSet } from 'mongodb-memory-server';

let rs: MongoMemoryReplSet | undefined;

/** Un replica set en memoria para toda la suite (permite transacciones). Cada archivo usa su propia BD. */
export async function setup() {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.TEST_MONGODB_URI = rs.getUri();
}

export async function teardown() {
  await rs?.stop();
}
