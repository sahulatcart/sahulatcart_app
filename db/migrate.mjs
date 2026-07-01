// Minimal migration runner. Applies db/migrations/*.sql in order, tracking applied
// migrations in a _migrations table. Usage: node --env-file=.env db/migrate.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('SUPABASE_DB_URL not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  await client.query(
    'create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())'
  );
  const done = new Set((await client.query('select name from _migrations')).rows.map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const f of files) {
    if (done.has(f)) {
      console.log(`= skip ${f} (already applied)`);
      continue;
    }
    process.stdout.write(`+ applying ${f} ... `);
    const sql = readFileSync(join(dir, f), 'utf8');
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into _migrations(name) values ($1)', [f]);
      await client.query('commit');
      console.log('ok');
    } catch (e) {
      await client.query('rollback');
      console.log('FAILED');
      console.error(e.message);
      process.exit(1);
    }
  }
  console.log('migrations complete');
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
