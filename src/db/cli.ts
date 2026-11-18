import { getEnv } from '../config/env.js';
import { migrate, migrationStatus } from './migrate.js';
import { createPool } from './pool.js';
import { seed } from './seed.js';

const command = process.argv[2];
const out = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  const env = getEnv();
  const db = createPool(env.DATABASE_URL, 2);
  try {
    switch (command) {
      case 'migrate': {
        const applied = await migrate(db);
        out(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
        break;
      }
      case 'seed': {
        const result = await seed(db);
        out(`Seeded ${result.brands} brands (${result.socialAccountsCreated} new social account slots).`);
        break;
      }
      case 'status': {
        const status = await migrationStatus(db);
        out(`Applied (${status.applied.length}): ${status.applied.join(', ') || '-'}`);
        out(`Pending (${status.pending.length}): ${status.pending.join(', ') || '-'}`);
        break;
      }
      default:
        console.error('Usage: tsx src/db/cli.ts <migrate|seed|status>');
        process.exitCode = 1;
    }
  } finally {
    await db.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
