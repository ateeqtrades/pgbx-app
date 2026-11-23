// Applies the database migrations (supabase/migrations/*.sql) in order to the production database and records each
// one, so running it again only applies new files. Works on any PostgreSQL: Google Cloud SQL or Supabase.
//
//   DATABASE_URL=postgres://user:password@host:5432/pgbx npm run db:migrate
//
// Each file runs in its own transaction: a failure leaves the database as it was before that file. Never run
// supabase/seed.sql on production; it is sample data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL first.'); process.exit(1); }
const { default: postgres } = await import('postgres');
const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require', connect_timeout: 20 });
try {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from schema_migrations`).map(r => r.name));
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) { console.log('  already applied  ' + f); continue; }
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    await sql.begin(async tx => {
      await tx.unsafe(text);
      await tx`insert into schema_migrations (name) values (${f})`;
    });
    console.log('  applied          ' + f); applied++;
  }
  console.log(`Done: ${applied} applied, ${files.length - applied} already there.`);
} catch (e) {
  console.error('Migration failed: ' + e.message);
  process.exitCode = 1;
} finally { await sql.end(); }
