/**
 * Local reset: DROP all user schemas in the current database.
 *
 * **Local and staging only — strictly forbidden in production.**
 *
 * Call chain: `pnpm db:reset` = `tsx src/reset.ts && pnpm migrate && pnpm seed`
 *   - This script only clears the database; structure rebuild and seed are done by the subsequent commands
 *
 * Safeguards:
 *   - By default, DATABASE_URL must point to localhost / 127.0.0.1 / ::1
 *   - Remote databases (staging, etc.) must explicitly set ALLOW_DB_RESET=1
 */
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDbClient } from './client';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

function writeLine(message = ''): void {
  process.stdout.write(`${message}\n`);
}

function unwrapRows<T>(rawRows: unknown): T[] {
  return Array.isArray(rawRows) ? (rawRows as T[]) : ((rawRows as { rows?: T[] }).rows ?? []);
}

function isLocalDatabaseUrl(databaseUrl: string): boolean {
  try {
    const url = new URL(databaseUrl.trim().replace(/^(['"])(.*)\1$/, '$2'));
    return LOCAL_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(resolve(process.cwd(), '../../.env'));
  } catch {
    // CI / other environments that already have env injected
  }

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('❌  DATABASE_URL is not configured');
    process.exit(1);
  }

  const local = isLocalDatabaseUrl(databaseUrl);
  const allowReset = process.env['ALLOW_DB_RESET'] === '1';
  if (!local && !allowReset) {
    console.error('❌  DATABASE_URL points to a remote database; refusing to run reset');
    console.error('    Use localhost for local development; to run against a remote (staging) database, set explicitly:');
    console.error('    ALLOW_DB_RESET=1 pnpm db:reset');
    process.exit(1);
  }

  const db = createDbClient(databaseUrl);

  const rawRows = await db.execute(sql`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name <> 'information_schema'
      AND schema_name NOT LIKE 'pg_%'
    ORDER BY schema_name
  `);
  const rows = unwrapRows<{ schema_name: string }>(rawRows);

  writeLine(`🗑   DROP all user schemas (${rows.length})`);
  for (const { schema_name: schemaName } of rows) {
    await db.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(schemaName)} CASCADE`);
    writeLine(`   ✓ ${schemaName}`);
  }
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "public"`);
  await db.execute(sql`GRANT USAGE ON SCHEMA "public" TO PUBLIC`);
  writeLine('   ✓ public (recreated)');

  writeLine('\n✅  Reset complete; pnpm migrate + pnpm seed will now rebuild the structure and the default local project');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌  Reset failed:', err);
  process.exit(1);
});
