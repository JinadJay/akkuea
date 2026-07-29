import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Retry database readiness probes so CI can tolerate the Postgres service still warming up.
export interface MigrationOptions {
  attempts?: number;
  delayMs?: number;
}

export async function waitForDatabaseConnection(
  connectionString: string,
  options: MigrationOptions = {},
  probe?: (connectionString: string) => Promise<void>,
): Promise<void> {
  const attempts = options.attempts ?? 30;
  const delayMs = options.delayMs ?? 2000;
  const connectionProbe = probe ?? (async (target) => {
    const probeClient = postgres(target, { max: 1, connect_timeout: 5 });
    try {
      await probeClient`SELECT 1`;
    } finally {
      await probeClient.end();
    }
  });

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await connectionProbe(connectionString);
      return;
    } catch (error) {
      if (attempt === attempts) {
        throw error;
      }

      console.warn(
        `[db] Database is not ready yet (attempt ${attempt}/${attempts}): ${error instanceof Error ? error.message : String(error)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function runMigrations(options: MigrationOptions = {}) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Migration failed: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  console.log('Waiting for PostgreSQL to become ready...');
  await waitForDatabaseConnection(connectionString, options);

  console.log('Running migrations...');

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  try {
    await migrate(db, { migrationsFolder: './drizzle/migrations' });
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  runMigrations();
}
