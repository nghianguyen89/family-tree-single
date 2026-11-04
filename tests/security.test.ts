import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { after, before, test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'
import JSZip from 'jszip'
import Papa from 'papaparse'

import { validateImportPayload } from '../utils/backup-validation'
import { exportToCsvZip } from '../utils/csv'
import { installAuthSessions } from './helpers/auth-sessions'

const require = createRequire(import.meta.url)
const braces = require('braces')
const admin = '11111111-1111-4111-8111-111111111111'
const member = '22222222-2222-4222-8222-222222222222'
const first = '33333333-3333-4333-8333-333333333333'
const second = '44444444-4444-4444-8444-444444444444'
const event = '55555555-5555-4555-8555-555555555555'
const migration = readFileSync(
  'docs/migrations/20261014000000_personal_fork_security.sql',
  'utf8'
)
const bootstrap = readFileSync('docs/bootstrap-admin.sql', 'utf8').replace(
  'replace-with-your-verified-email@example.com',
  'owner@example.com'
)
const schema = readFileSync('docs/schema.sql', 'utf8')
const yearRangeMigration = readFileSync(
  'docs/migrations/20261014010000_add_person_year_ranges.sql',
  'utf8'
)
const db = new PGlite()
const t = (key: string) => key
const backup = () => ({
  persons: [first, second].map((id) => ({
    id,
    full_name: 'Imported',
    gender: 'male',
    is_deceased: false,
    is_in_law: false
  })),
  relationships: [
    { person_a: first, person_b: second, type: 'biological_child' }
  ],
  person_details_private: [{ person_id: first, phone_number: '0123456789' }],
  custom_events: [{ id: event, name: 'New event', event_date: '2026-10-14' }]
})

before(async () => {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA private;
    CREATE SCHEMA storage;
    CREATE SCHEMA extensions;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects (id uuid PRIMARY KEY, bucket_id text, name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT USAGE ON SCHEMA storage TO authenticated;
    GRANT SELECT ON storage.objects TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
  `)
  await installAuthSessions(db)
  // Supabase provides pgcrypto. Its crypto functions are outside these tests;
  // load the real schema and complete migration sequence without that extension.
  await db.exec(
    schema.replace(
      'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;',
      ''
    )
  )
  // Model an existing installation without the new columns before upgrading.
  await db.exec(
    'ALTER TABLE public.persons DROP COLUMN birth_year_from, DROP COLUMN birth_year_to, DROP COLUMN death_year_from, DROP COLUMN death_year_to'
  )
  for (const file of readdirSync('docs/migrations')
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    await db.exec(readFileSync(`docs/migrations/${file}`, 'utf8'))
  }
  // Applying the migration twice must preserve existing installation behavior.
  await db.exec(migration)
  await db.exec(yearRangeMigration)
  await db.exec(
    readFileSync(
      'docs/migrations/20261014020000_family_intake_and_memorial.sql',
      'utf8'
    )
  )
  await db.exec(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    INSERT INTO auth.users VALUES ('${admin}', 'owner@example.com', NULL);
    INSERT INTO auth.users VALUES ('${member}', 'member@example.com', now());
  `)
})
after(async () => {
  await db.close()
})

async function importAs(user: string, payload: unknown) {
  return db.transaction(async (transaction) => {
    await transaction.exec('SET LOCAL ROLE authenticated')
    await transaction.query(
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [user]
    )
    await transaction.query('SELECT public.import_family_backup($1::jsonb)', [
      JSON.stringify(payload)
    ])
  })
}

async function snapshot() {
  return Promise.all(
    ['persons', 'relationships', 'person_details_private', 'custom_events'].map(
      (table) => db.query(`SELECT * FROM public.${table} ORDER BY 1`)
    )
  )
}

test('first signup stays unverified and inactive; bootstrap requires verified owner', async () => {
  const { rows } = await db.query<{
    role: string
    is_active: boolean
    email_confirmed_at: string | null
  }>(
    'SELECT role, is_active, email_confirmed_at FROM public.profiles JOIN auth.users USING (id) WHERE id = $1',
    [admin]
  )
  assert.deepEqual(rows[0], {
    role: 'member',
    is_active: false,
    email_confirmed_at: null
  })
  await assert.rejects(db.exec(bootstrap), /verified email/)
  await db.query(
    'UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1',
    [admin]
  )
  await db.exec(bootstrap)
  await assert.rejects(db.exec(bootstrap), /already exists/)
})

test('admin imports all tables and preserves DB defaults', async () => {
  await importAs(admin, backup())
  const { rows } = await db.query<{ created_by: string; created_at: string }>(
    'SELECT created_by, created_at FROM custom_events'
  )
  assert.equal(rows[0].created_by, admin)
  assert.ok(rows[0].created_at)
})

test('year ranges survive backup imports and repeated migration; invalid edits fail', async () => {
  const payload = backup()
  Object.assign(payload.persons[0], {
    birth_year_from: 1880,
    birth_year_to: 1885,
    death_year_from: 1937,
    death_year_to: 1939,
    is_deceased: true
  })
  Object.assign(payload.persons[1], {
    birth_year: 1900,
    birth_month: 1,
    birth_day: 2
  })
  await importAs(admin, payload)
  await db.exec(yearRangeMigration)
  const { rows } = await db.query(
    'SELECT birth_year_from, birth_year_to, death_year_from, death_year_to, birth_year, death_year FROM persons WHERE id = $1',
    [first]
  )
  assert.deepEqual(rows[0], {
    birth_year_from: 1880,
    birth_year_to: 1885,
    death_year_from: 1937,
    death_year_to: 1939,
    birth_year: null,
    death_year: null
  })
  const exact = await db.query(
    'SELECT birth_year, birth_month, birth_day FROM persons WHERE id = $1',
    [second]
  )
  assert.deepEqual(exact.rows[0], {
    birth_year: 1900,
    birth_month: 1,
    birth_day: 2
  })
  for (const update of [
    'birth_year_from = 1886',
    'birth_year_to = NULL',
    'birth_year = 1880',
    'death_lunar_year = 1938',
    'is_deceased = false',
    'death_year_from = 1870, death_year_to = 1875'
  ]) {
    await assert.rejects(
      db.query(`UPDATE persons SET ${update} WHERE id = $1`, [first]),
      /check constraint/
    )
  }
  assert.equal(validateImportPayload(payload, t), null)
  const invalid = structuredClone(payload)
  Object.assign(invalid.persons[0], { birth_year_to: 1879 })
  assert.equal(validateImportPayload(invalid, t), 'invalidPersonRecord')
  const before = await snapshot()
  await assert.rejects(importAs(admin, invalid), /check constraint/)
  assert.deepEqual(await snapshot(), before)
  await importAs(admin, backup())
})

test('late event failure rolls back deletions and every preceding table insert', async () => {
  const before = await snapshot()
  const invalid = backup()
  invalid.persons[0].full_name = 'Must roll back'
  invalid.custom_events[0].event_date = '2026-02-30'
  await assert.rejects(importAs(admin, invalid))
  assert.deepEqual(await snapshot(), before)
})

test('bad foreign key and duplicate persons roll back the entire import', async () => {
  const before = await snapshot()
  const invalid = backup()
  invalid.relationships[0].person_b = event
  await assert.rejects(importAs(admin, invalid))
  const duplicate = backup()
  duplicate.persons[1].id = first
  await assert.rejects(importAs(admin, duplicate))
  assert.deepEqual(await snapshot(), before)
})

test('pending, active member, and anonymous users cannot invoke destructive import', async () => {
  const before = await snapshot()
  await assert.rejects(importAs(member, backup()), /Access denied/)
  await db.query('UPDATE public.profiles SET is_active = true WHERE id = $1', [
    member
  ])
  await assert.rejects(importAs(member, backup()), /Access denied/)
  await assert.rejects(
    db.transaction(async (transaction) => {
      await transaction.exec('SET LOCAL ROLE anon')
      await transaction.query('SELECT public.import_family_backup($1::jsonb)', [
        JSON.stringify(backup())
      ])
    }),
    /permission denied/
  )
  assert.deepEqual(await snapshot(), before)
})

test('members cannot read raw gallery storage to mint bearer URLs, admins can manage it', async () => {
  await db.query(
    'INSERT INTO storage.objects (id, bucket_id, name) VALUES ($1, $2, $3)',
    [event, 'gallery', 'photo.png']
  )
  async function readAs(user: string) {
    return db.transaction(async (transaction) => {
      await transaction.exec('SET LOCAL ROLE authenticated')
      await transaction.query(
        "SELECT set_config('request.jwt.claim.sub', $1, true)",
        [user]
      )
      return transaction.query(
        'SELECT id FROM storage.objects WHERE bucket_id = $1',
        ['gallery']
      )
    })
  }
  assert.equal((await readAs(member)).rows.length, 0)
  assert.equal((await readAs(admin)).rows.length, 1)
})

test('validator rejects impossible dates, invalid numbers/booleans, and duplicates', () => {
  assert.equal(validateImportPayload(backup(), t), null)
  for (const fields of [
    { birth_year: 2026, birth_month: 2, birth_day: 30 },
    { birth_year: 2026.5 },
    { birth_month: '2' },
    { generation: -1 },
    { is_deceased: 'false' },
    { death_lunar_day: 31 }
  ]) {
    const payload = backup()
    Object.assign(payload.persons[0], fields)
    assert.ok(validateImportPayload(payload, t))
  }
  const invalid = backup()
  invalid.custom_events[0].event_date = '2026-02-30'
  assert.ok(validateImportPayload(invalid, t))
  invalid.custom_events[0].event_date = '2024-02-29'
  assert.equal(validateImportPayload(invalid, t), null)
  invalid.relationships.push(invalid.relationships[0])
  assert.ok(validateImportPayload(invalid, t))
})

test('CSV exports escape formula prefixes in all four tables', async () => {
  const payload = {
    persons: [{ full_name: '=HYPERLINK("https://example.com")' }],
    relationships: [{ note: '+1+1' }],
    person_details_private: [
      {
        person_id: first,
        phone_number: '@SUM(1)',
        occupation: null,
        current_residence: null
      }
    ],
    custom_events: [
      {
        id: event,
        name: '-1+1',
        content: null,
        event_date: '2026-10-14',
        location: null,
        created_by: admin
      }
    ]
  }
  const archive = await JSZip.loadAsync(
    await (await exportToCsvZip(payload)).arrayBuffer()
  )
  for (const [file, column] of [
    ['persons.csv', 'full_name'],
    ['relationships.csv', 'note'],
    ['person_details_private.csv', 'phone_number'],
    ['custom_events.csv', 'name']
  ]) {
    const csv = await archive.file(file)!.async('text')
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true })
    assert.ok(parsed.data[0][column].startsWith("'"))
  }
})

test('braces patch rejects deep patterns and ASTs while keeping normal globs', () => {
  assert.deepEqual(braces.expand('a/{b,c}/d'), ['a/b/d', 'a/c/d'])
  const deep = '{'.repeat(4000) + 'a,b' + '}'.repeat(4000)
  for (const operation of [
    braces,
    braces.parse,
    braces.compile,
    braces.expand,
    braces.stringify
  ]) {
    assert.throws(() => operation(deep), SyntaxError)
  }
  const ast: { nodes?: unknown[] } = {}
  let current = ast
  for (let index = 0; index < 4000; index++) {
    const next = { nodes: [] }
    current.nodes = [next]
    current = next
  }
  for (const operation of [braces.compile, braces.expand, braces.stringify]) {
    assert.throws(() => operation(ast), SyntaxError)
  }
})
