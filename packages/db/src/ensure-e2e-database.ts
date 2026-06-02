import { resolve } from 'node:path';
import postgres from 'postgres';

const DEFAULT_E2E_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/proofhound_e2e';
const DEFAULT_ADMIN_DATABASE = 'postgres';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

function writeLine(message = ''): void {
  process.stdout.write(`${message}\n`);
}

function loadRootEnv(): void {
  try {
    process.loadEnvFile(resolve(process.cwd(), '../../.env'));
  } catch {
    // CI / container deployments can provide env vars externally.
  }
}

function unwrapEnvValue(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/, '$2');
}

function parseDatabaseUrl(databaseUrl: string): URL {
  const url = new URL(unwrapEnvValue(databaseUrl));
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('E2E_DATABASE_URL_must_use_postgres_protocol');
  }
  if (!url.pathname || url.pathname === '/') {
    throw new Error('E2E_DATABASE_URL_must_include_database_name');
  }
  return url;
}

function getDatabaseName(url: URL): string {
  return decodeURIComponent(url.pathname.slice(1));
}

function isLocalDatabaseHost(url: URL): boolean {
  return LOCAL_HOSTNAMES.has(url.hostname);
}

function getAdminDatabaseUrl(targetUrl: URL): string {
  const explicitAdminUrl = process.env['E2E_DATABASE_ADMIN_URL'];
  if (explicitAdminUrl) return unwrapEnvValue(explicitAdminUrl);

  const adminUrl = new URL(targetUrl.toString());
  adminUrl.pathname = `/${process.env['E2E_DATABASE_ADMIN_DB'] ?? DEFAULT_ADMIN_DATABASE}`;
  return adminUrl.toString();
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function main(): Promise<void> {
  loadRootEnv();

  const databaseUrl = process.env['E2E_DATABASE_URL'] ?? DEFAULT_E2E_DATABASE_URL;
  const targetUrl = parseDatabaseUrl(databaseUrl);
  const databaseName = getDatabaseName(targetUrl);

  if (!isLocalDatabaseHost(targetUrl) && process.env['ALLOW_E2E_DB_CREATE'] !== '1') {
    console.error('❌  E2E_DATABASE_URL points to a remote database; refusing to auto-create');
    console.error('    To create a remote e2e database, set ALLOW_E2E_DB_CREATE=1 explicitly');
    process.exit(1);
  }

  const adminUrl = getAdminDatabaseUrl(targetUrl);
  const sql = postgres(adminUrl, { max: 1 });

  try {
    const rows = await sql<{ exists: number }[]>`
      SELECT 1 AS exists
      FROM pg_database
      WHERE datname = ${databaseName}
      LIMIT 1
    `;

    if (rows.length > 0) {
      writeLine(`✅  E2E database already exists: ${databaseName}`);
      return;
    }

    writeLine(`⏳  Creating E2E database: ${databaseName}`);
    await sql.unsafe(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    writeLine(`✅  E2E database created: ${databaseName}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('❌  Failed to ensure E2E database:', error);
  process.exit(1);
});
