import { connectDb, disconnectDb } from '../db/connect';
import { JOB_NAMES, runJob, type JobName } from '../services/jobs/runner';

/**
 * Lanza un job a mano: `npm run job -- <job> [--year=NNNN]`.
 * Imprime el registro de la ejecución (JobRunDto) en JSON.
 */

function usage(): string {
  return `Uso: npm run job -- <job> [--year=NNNN]\nJobs disponibles: ${JOB_NAMES.join(', ')}`;
}

function parseArgs(argv: string[]): { name: JobName; year?: number } {
  const [name, ...rest] = argv;
  if (!name || !(JOB_NAMES as readonly string[]).includes(name)) {
    throw new Error(`Job desconocido: ${name ?? '(vacío)'}.\n${usage()}`);
  }
  let year: number | undefined;
  for (const arg of rest) {
    const match = /^--year=(\d{4})$/.exec(arg);
    if (!match) throw new Error(`Argumento no válido: ${arg}.\n${usage()}`);
    year = Number(match[1]);
  }
  return { name: name as JobName, year };
}

async function main(): Promise<void> {
  const { name, year } = parseArgs(process.argv.slice(2));
  await connectDb();
  try {
    const result = await runJob(name, { trigger: 'manual', year });
    console.log(
      JSON.stringify(result ?? { job: name, status: 'locked', message: 'bloqueado por otra réplica' }, null, 2),
    );
    if (result?.status === 'failed') process.exitCode = 1;
  } finally {
    await disconnectDb();
  }
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
