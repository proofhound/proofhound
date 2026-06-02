/**
 * One-shot cleanup of DBOS integration test leftovers.
 *
 * Purpose: clean up the dangling `dbos_test_*` schemas left by previously interrupted/crashed vitest runs in one go.
 * After that, setup.ts's beforeAll backstop logic + schema-level isolation ensure new tests no longer dirty the database.
 *
 * Only drops schemas where information_schema.schemata's schema_name LIKE 'dbos_test_%' (DROP CASCADE).
 *
 * Untouched:
 *   - The default dbos schema (we cannot distinguish test and production rows by application_id / name)
 *   - Any business tables (models/datasets/prompts/...) data
 *
 * Usage: pnpm db:clean-test-residue
 */
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDbClient } from './client';

function writeLine(message = ''): void {
  process.stdout.write(`${message}\n`);
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(resolve(process.cwd(), '../../.env'));
  } catch {
    // CI / other environments already with env injected
  }

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('❌  DATABASE_URL is not configured');
    process.exit(1);
  }

  const db = createDbClient(databaseUrl);

  // DBOS system db leftover schemas
  const rawRows = await db.execute(sql`
    SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'dbos_test_%'
  `);
  const rows: Array<{ schema_name: string }> = Array.isArray(rawRows)
    ? (rawRows as unknown as Array<{ schema_name: string }>)
    : ((rawRows as unknown as { rows?: Array<{ schema_name: string }> }).rows ?? []);

  const droppedSchemas: string[] = [];
  for (const row of rows) {
    await db.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(row.schema_name)} CASCADE`);
    droppedSchemas.push(row.schema_name);
  }

  writeLine('✅  DBOS integration test leftovers cleaned up');
  writeLine(`  • DBOS system schemas (dbos_test_*):               ${droppedSchemas.length}`);
  if (droppedSchemas.length > 0) {
    writeLine(`    ${droppedSchemas.join(', ')}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('❌  Cleanup failed:', err);
  process.exit(1);
});
