import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

import { installAuthSessions } from './helpers/auth-sessions'

const bundle = [
  readFileSync('docs/schema.sql', 'utf8').replace(
    'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;',
    ''
  ),
  ...readdirSync('docs/migrations')
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => readFileSync(`docs/migrations/${file}`, 'utf8'))
].join('\n')
const owner = '11111111-1111-4111-8111-111111111111'
const person = '22222222-2222-4222-8222-222222222222'
const object = '33333333-3333-4333-8333-333333333333'
const content = '44444444-4444-4444-8444-444444444444'
const bOnlyOwner = '55555555-5555-4555-8555-555555555555'
const token = 'a'.repeat(64)

async function prepare(db: PGlite, label: string) {
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,created_at timestamptz DEFAULT now());
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage TO anon,authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO anon,authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
  `)
  await installAuthSessions(db)
  await db.exec(bundle)
  await db.query(
    'INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ($1,$2,now())',
    [owner, `${label}@example.com`]
  )
  await db.query(
    "UPDATE profiles SET role='admin',is_active=true WHERE id=$1",
    [owner]
  )
  await db.query(
    "INSERT INTO persons(id,full_name,gender,is_deceased) VALUES ($1,$2,'male',false)",
    [person, `${label} ancestor`]
  )
  await db.query(
    'INSERT INTO person_details_private(person_id,phone_number) VALUES ($1,$2)',
    [person, `${label} private contact`]
  )
  await db.query(
    'UPDATE home_settings SET title=$1,introduction=$2 WHERE id=1',
    [`${label} edited title`, `${label} edited introduction`]
  )
  await db.query(
    "INSERT INTO home_content(id,kind,title,status,visibility,publish_at) VALUES ($1,'article',$2,'published','internal',now()-interval '1 day')",
    [content, `${label} internal article`]
  )
  await db.query("INSERT INTO storage.objects VALUES ($1,'home-content',$2)", [
    object,
    `${label}/private-photo.jpg`
  ])
  await db.query(
    "INSERT INTO family_intake_links(token_hash,title,root_person_id,expires_at,created_by) VALUES (md5($1),$2,$3,now()+interval '1 day',$4)",
    [token, `${label} intake`, person, owner]
  )
  await db.query('SELECT submit_family_intake($1,$2::jsonb)', [
    token,
    JSON.stringify({
      anchor_id: person,
      sender_name: `${label} sender`,
      sender_contact: `${label}@example.com`,
      note: '',
      people: [
        {
          client_id: object,
          relation: 'child',
          relative_to: 'anchor',
          data: {
            full_name: `${label} pending child`,
            gender: 'male',
            is_deceased: false
          }
        }
      ]
    })
  ])
}
async function asUser(
  db: PGlite,
  user: string | null,
  sql: string,
  args: unknown[] = []
) {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`)
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
      user || ''
    ])
    return tx.query(sql, args)
  })
}
async function snapshot(db: PGlite) {
  return Promise.all(
    [
      'auth.users',
      'public.profiles',
      'public.persons',
      'public.person_details_private',
      'public.home_settings',
      'public.home_content',
      'storage.objects',
      'public.family_intake_links',
      'public.family_intake_submissions'
    ].map(
      async (table) =>
        (await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows
    )
  )
}

test('independent A/B projects isolate Auth, private data, CMS, storage, intake and upgrades with rollback', async () => {
  const a = new PGlite(),
    b = new PGlite()
  try {
    await prepare(a, 'family-a')
    await prepare(b, 'family-b')
    const aBefore = await snapshot(a)
    const bBefore = await snapshot(b)
    assert.notDeepEqual(aBefore, bBefore)
    for (const [db, label] of [
      [a, 'family-a'],
      [b, 'family-b']
    ] as const) {
      assert.equal(
        (await db.query<{ title: string }>('SELECT title FROM home_settings'))
          .rows[0].title,
        `${label} edited title`
      )
      assert.equal(
        (
          await db.query<{ sender_name: string }>(
            "SELECT payload->>'sender_name' AS sender_name FROM family_intake_submissions"
          )
        ).rows[0].sender_name,
        `${label} sender`
      )
      await assert.rejects(() =>
        asUser(db, null, 'SELECT * FROM person_details_private')
      )
      assert.equal(
        (await asUser(db, null, 'SELECT * FROM home_content')).rows.length,
        0
      )
      assert.equal(
        (await asUser(db, null, 'SELECT * FROM storage.objects')).rows.length,
        0
      )
    }
    // A token/user id issued by B is not an administrator in A.
    await b.query(
      'INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ($1,$2,now())',
      [bOnlyOwner, 'b-only@example.com']
    )
    await b.query(
      "UPDATE profiles SET role='admin',is_active=true WHERE id=$1",
      [bOnlyOwner]
    )
    assert.deepEqual(
      (await asUser(b, bOnlyOwner, 'SELECT is_admin() AS allowed')).rows,
      [{ allowed: true }]
    )
    assert.deepEqual(
      (await asUser(a, bOnlyOwner, 'SELECT is_admin() AS allowed')).rows,
      [{ allowed: false }]
    )
    assert.equal(
      (await asUser(a, bOnlyOwner, 'SELECT * FROM persons')).rows.length,
      0
    )

    // Only B replays the selected schema/migrations. Idempotent initial defaults
    // preserve edited settings; A is kept at its original version/state.
    await b.exec(bundle)
    assert.equal(
      (await b.query<{ title: string }>('SELECT title FROM home_settings'))
        .rows[0].title,
      'family-b edited title'
    )
    await asUser(
      b,
      bOnlyOwner,
      "UPDATE home_settings SET title='B after upgrade' WHERE id=1"
    )
    assert.deepEqual(await snapshot(a), aBefore)
    const bAfter = await snapshot(b)

    // A late import error occurs after replacement has begun, then rolls back.
    await assert.rejects(() =>
      asUser(b, bOnlyOwner, 'SELECT import_family_backup($1::jsonb)', [
        JSON.stringify({
          persons: [
            {
              id: person,
              full_name: 'Must roll back',
              gender: 'male',
              is_deceased: false
            }
          ],
          relationships: [],
          person_details_private: [],
          custom_events: [
            { id: content, name: 'Invalid date', event_date: '2026-02-30' }
          ]
        })
      ])
    )
    assert.deepEqual(await snapshot(b), bAfter)
    await assert.rejects(() =>
      b.transaction(async (tx) => {
        await tx.exec(
          "UPDATE home_settings SET title='Failed migration'; CREATE TABLE migration_must_rollback(id int); SELECT 1/0;"
        )
      })
    )
    assert.equal(
      (
        await b.query<{ table: string | null }>(
          "SELECT to_regclass('public.migration_must_rollback')::text AS table"
        )
      ).rows[0].table,
      null
    )
    assert.deepEqual(await snapshot(b), bAfter)
    assert.deepEqual(await snapshot(a), aBefore)
  } finally {
    await a.close()
    await b.close()
  }
})
