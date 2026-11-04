import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

import fixture from '../../tests/fixtures/release-manifest.json'

const require = createRequire(import.meta.url)
const { mock } = require('bun:test')
const db = new PGlite()
let admin = false
let bound = true
let connections = 0
let failMigration = false
let lockSeen = false
let fetches = 0
const originalFetch = globalThis.fetch
const oldFeed = process.env.PRODUCT_RELEASE_MANIFEST_URL
const oldDatabase = process.env.SUPABASE_DB_URL
process.env.SUPABASE_DB_URL =
  'postgresql://fixture:fixture@db.fixture.supabase.co/postgres'
delete process.env.PRODUCT_RELEASE_MANIFEST_URL

mock.module('../../lib/i18n/server', () => ({
  getServerTranslations: async () => ({ t: (key: string) => key })
}))
mock.module('../../utils/supabase/queries', () => ({
  getIsAdmin: async () => admin
}))
mock.module('../../utils/deployment', () => ({
  assertDatabaseTarget: () => {
    if (!bound) throw new Error('Wrong fixture target')
  }
}))
type Database = Pick<PGlite, 'query' | 'exec'>
function adapter(database: Database) {
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce(
      (text, part, i) => text + (i ? `$${i}` : '') + part,
      ''
    )
    return (await database.query(query, values)).rows
  }
  sql.unsafe = async (query: string) => {
    if (query.includes('pg_advisory_xact_lock')) lockSeen = true
    if (failMigration && query.includes('Authorize editors directly.'))
      throw new Error('Fixture migration failure')
    // PGlite has no cross-connection advisory locks or Supabase pgcrypto extension.
    const supported = query
      .replace(
        /SELECT pg_advisory_xact_lock\(hashtext\('giapha_os_app_migrations'\)\);/,
        ''
      )
      .replace(
        'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;',
        ''
      )
    return (await database.exec(supported)).at(-1)?.rows ?? []
  }
  return sql
}
mock.module('postgres', () => ({
  default: () => {
    connections++
    return {
      ...adapter(db),
      begin: (
        callback: (sql: ReturnType<typeof adapter>) => Promise<unknown>
      ) => db.transaction((tx) => callback(adapter(tx))),
      end: async () => {}
    }
  }
}))
const actions = await import('../../app/actions/migrations')
globalThis.fetch = (async () => {
  fetches++
  return Response.json(fixture)
}) as typeof fetch

after(async () => {
  globalThis.fetch = originalFetch
  if (oldFeed === undefined) delete process.env.PRODUCT_RELEASE_MANIFEST_URL
  else process.env.PRODUCT_RELEASE_MANIFEST_URL = oldFeed
  if (oldDatabase === undefined) delete process.env.SUPABASE_DB_URL
  else process.env.SUPABASE_DB_URL = oldDatabase
  await db.close()
})

test('release and migration actions retain authorization before feed or SQL access', async () => {
  const result = await actions.runPendingMigrations()
  assert.equal(result.success, false)
  assert.equal(connections, 0)
  assert.equal((await actions.getSourceVersionStatus()).state, 'unknown')
  assert.equal(fetches, 0)
  admin = true
})

test('feed failures are unknown; explicit validated fixture detects mandatory releases', async () => {
  assert.equal((await actions.getSourceVersionStatus()).state, 'unknown')
  process.env.PRODUCT_RELEASE_MANIFEST_URL =
    'https://releases.example.test/product.json'
  assert.equal((await actions.getSourceVersionStatus()).state, 'mandatory')
  globalThis.fetch = (async () => {
    throw new Error('Fixture unavailable')
  }) as typeof fetch
  assert.equal((await actions.getSourceVersionStatus()).state, 'unknown')
})

test('wrong deployment target is rejected before opening SQL', async () => {
  bound = false
  assert.equal((await actions.runPendingMigrations()).success, false)
  assert.equal(connections, 0)
  bound = true
})

test('runner transaction rolls back failure and applies selected migrations independently of release feed', async () => {
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,created_at timestamptz DEFAULT now());
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
  `)
  const fetchesBefore = fetches
  failMigration = true
  assert.equal((await actions.runPendingMigrations()).success, false)
  assert.equal(
    (
      await db.query<{ name: string | null }>(
        "SELECT to_regclass('public.app_migrations') AS name"
      )
    ).rows[0]?.name,
    null
  )
  failMigration = false
  const result = await actions.runPendingMigrations()
  assert.equal(result.success, true)
  assert.ok(result.applied?.length)
  assert.equal(lockSeen, true)
  assert.equal(fetches, fetchesBefore)
  assert.equal((await actions.runPendingMigrations()).applied?.length, 0)
  await db.exec(
    "INSERT INTO public.app_migrations(migration_id,file_name) VALUES ('future-version','future.sql')"
  )
  assert.equal((await actions.runPendingMigrations()).success, false)
  assert.equal((await actions.getMigrationStatus()).schemaCompatible, false)
})
