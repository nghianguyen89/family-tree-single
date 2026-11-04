import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

import { buildSetupSqlBundle } from '../utils/setup-sql'
import { installAuthSessions } from './helpers/auth-sessions'

const migrationPath = 'docs/migrations/20261102010000_shared_viewer.sql'
const migration = readFileSync(migrationPath, 'utf8')
const id = (n: number) =>
  `ab000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [admin, member, viewer, root, branch, branchPerson, event, asset] = [
  1, 2, 3, 10, 11, 12, 13, 14
].map(id)
const files = [
  {
    file: 'docs/schema.sql',
    sql: readFileSync('docs/schema.sql', 'utf8').replace(
      'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;',
      ''
    )
  },
  ...readdirSync('docs/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({
      file: `docs/migrations/${f}`,
      sql: readFileSync(`docs/migrations/${f}`, 'utf8')
    }))
]

async function prepare() {
  const db = new PGlite()
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,
      raw_user_meta_data jsonb,created_at timestamptz DEFAULT now());
    CREATE TABLE auth.identities(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),provider text,provider_id text);
    CREATE TABLE auth.refresh_tokens(id int PRIMARY KEY,user_id text);
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA auth,storage TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
    GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
  `)
  await installAuthSessions(db)
  await db.exec(buildSetupSqlBundle(files))
  for (const [user, email] of [
    [admin, 'admin@example.test'],
    [member, 'member@example.test'],
    [viewer, 'SHARED-VIEWER@family-tree.invalid']
  ]) {
    await db.query(
      `INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)
       VALUES($1,$2,now(),' {"role":"admin","is_active":true,"is_shared_viewer":true}'::jsonb)`,
      [user, email]
    )
  }
  await db.query(
    "UPDATE profiles SET role='admin',is_active=true WHERE id=$1",
    [admin]
  )
  await db.query('UPDATE profiles SET is_active=true WHERE id=$1', [member])
  await db.query(
    "INSERT INTO persons(id,full_name,gender,is_in_law) VALUES($1,'Fictional ancestor','male',true)",
    [root]
  )
  await db.query(
    "INSERT INTO family_branches(id,name,anchor_person_id,root_person_id) VALUES($1,'Fictional branch',$2,$2)",
    [branch, root]
  )
  await db.query(
    "INSERT INTO persons(id,full_name,gender,family_branch_id) VALUES($1,'Fictional private person','female',$2)",
    [branchPerson, branch]
  )
  await db.query(
    "INSERT INTO person_details_private(person_id,phone_number) VALUES($1,'fictional')",
    [root]
  )
  await db.query(
    "INSERT INTO custom_events(id,name,event_date,created_by) VALUES($1,'Fictional event',CURRENT_DATE,$2)",
    [event, viewer]
  )
  await db.query(
    "INSERT INTO media_assets(id,storage_bucket,storage_path,title,library_visible) VALUES($1,'media-library','fictional.webp','Fictional image',true)",
    [asset]
  )
  return db
}

async function as(
  db: PGlite,
  user: string,
  sql: string,
  params: unknown[] = []
) {
  return db.transaction(async (tx) => {
    await tx.exec('SET LOCAL ROLE authenticated')
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user])
    return tx.query<Record<string, unknown>>(sql, params)
  })
}

async function activate(db: PGlite) {
  await db.transaction(async (tx) => {
    await tx.exec('SET LOCAL ROLE service_role')
    await tx.query(
      'UPDATE profiles SET is_active=true WHERE id=$1 AND is_shared_viewer',
      [viewer]
    )
  })
}

test('shared identity is inactive, metadata cannot elevate signup, and role/person/flag invariants survive admin RPCs', async () => {
  const db = await prepare()
  try {
    assert.deepEqual(
      (
        await db.query(
          'SELECT role,is_active,is_shared_viewer,person_id FROM profiles WHERE id=$1',
          [viewer]
        )
      ).rows[0],
      {
        role: 'member',
        is_active: false,
        is_shared_viewer: true,
        person_id: null
      }
    )
    assert.equal(
      (
        await db.query<Record<string, unknown>>(
          'SELECT is_shared_viewer FROM profiles WHERE id=$1',
          [member]
        )
      ).rows[0].is_shared_viewer,
      false
    )
    assert.equal(
      (await as(db, viewer, 'SELECT id FROM persons')).rows.length,
      0
    )
    await activate(db)
    await assert.rejects(
      as(db, admin, "SELECT public.set_user_role($1,'editor')", [viewer]),
      /profiles_shared_viewer_identity/
    )
    await assert.rejects(
      as(db, admin, 'SELECT public.set_user_person($1,$2)', [viewer, root]),
      /profiles_shared_viewer_identity/
    )
    await assert.rejects(
      db.query('UPDATE profiles SET is_shared_viewer=false WHERE id=$1', [
        viewer
      ]),
      /cannot be removed/
    )
    await assert.rejects(
      db.query('UPDATE profiles SET is_shared_viewer=true WHERE id=$1', [
        member
      ]),
      /reserved Auth identity/
    )
    await assert.rejects(
      db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [
        id(4),
        'shared-viewer@family-tree.invalid'
      ]),
      /profiles_one_shared_viewer/
    )
    // Simulate an accidental future profile-update grant/policy: the trigger and
    // restrictive policy must still prevent promotion by a normal member.
    await db.exec(`GRANT UPDATE(is_shared_viewer) ON profiles TO authenticated;
      CREATE POLICY fixture_profile_update ON profiles FOR UPDATE TO authenticated USING (id=auth.uid()) WITH CHECK (id=auth.uid());`)
    await assert.rejects(
      as(db, member, 'UPDATE profiles SET is_shared_viewer=true WHERE id=$1', [
        member
      ]),
      /Only active administrators/
    )
    assert.equal(
      (
        await as(
          db,
          viewer,
          'UPDATE profiles SET is_shared_viewer=false WHERE id=$1 RETURNING id',
          [viewer]
        )
      ).rows.length,
      0
    )
  } finally {
    await db.close()
  }
})

test('viewer can read main tree/events/gallery but cannot read private branches or mutate events; ordinary member can insert', async () => {
  const db = await prepare()
  try {
    await activate(db)
    assert.deepEqual((await as(db, viewer, 'SELECT id FROM persons')).rows, [
      { id: root }
    ])
    assert.equal(
      (await as(db, viewer, 'SELECT id FROM custom_events')).rows.length,
      1
    )
    assert.equal(
      (await as(db, viewer, 'SELECT id FROM media_assets')).rows.length,
      1
    )
    for (const table of [
      'person_details_private',
      'family_branches',
      'family_branch_members'
    ])
      assert.equal(
        (await as(db, viewer, `SELECT * FROM ${table}`)).rows.length,
        0
      )
    assert.equal(
      (
        await as(
          db,
          viewer,
          'SELECT public.can_view_family_branch($1) AS allowed',
          [branch]
        )
      ).rows[0].allowed,
      false
    )
    await assert.rejects(
      as(
        db,
        viewer,
        "INSERT INTO custom_events(name,event_date) VALUES('Forbidden',CURRENT_DATE)"
      ),
      /row-level security/
    )
    assert.equal(
      (
        await as(
          db,
          viewer,
          "UPDATE custom_events SET name='Forbidden' WHERE id=$1 RETURNING id",
          [event]
        )
      ).rows.length,
      0
    )
    assert.equal(
      (
        await as(
          db,
          viewer,
          'DELETE FROM custom_events WHERE id=$1 RETURNING id',
          [event]
        )
      ).rows.length,
      0
    )
    await as(
      db,
      member,
      "INSERT INTO custom_events(name,event_date) VALUES('Member event',CURRENT_DATE)"
    )
    for (const sql of [
      "SELECT public.set_user_role($1,'admin')",
      'SELECT public.set_user_person($1,NULL)',
      'SELECT public.attach_media_asset($1)',
      "SELECT public.import_family_backup('{}'::jsonb)",
      "SELECT public.apply_lineage_updates('[]'::jsonb)"
    ])
      await assert.rejects(
        as(db, viewer, sql, sql.includes('$1') ? [member] : []),
        /Access denied/
      )
    // Add permissive fixture policies to verify the restriction itself rather
    // than relying on today's member role policies to deny these writes.
    await db.exec(`CREATE POLICY fixture_person_insert ON persons FOR INSERT TO authenticated WITH CHECK (true);
      CREATE POLICY fixture_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (true);`)
    await assert.rejects(
      as(
        db,
        viewer,
        "INSERT INTO persons(full_name,gender) VALUES('Forbidden','male')"
      ),
      /row-level security/
    )
    await assert.rejects(
      as(
        db,
        viewer,
        "INSERT INTO storage.objects VALUES($1,'avatars','forbidden.webp')",
        [id(40)]
      ),
      /row-level security/
    )
  } finally {
    await db.close()
  }
})

test('admin can revoke shared sessions only; migration and full bundle replay preserve restrictions', async () => {
  const db = await prepare()
  try {
    await activate(db)
    await db.exec(migration)
    await db.exec(buildSetupSqlBundle(files))
    assert.equal(
      (await as(db, viewer, 'SELECT id FROM persons')).rows.length,
      1
    )
    for (const user of [viewer, member])
      await assert.rejects(
        as(db, user, 'SELECT public.revoke_shared_viewer_sessions($1)', [
          viewer
        ]),
        /Access denied/
      )
    await assert.rejects(
      as(db, admin, 'SELECT public.revoke_shared_viewer_sessions($1)', [
        member
      ]),
      /does not exist/
    )
    await db.query('DELETE FROM auth.sessions WHERE user_id=$1', [admin])
    await assert.rejects(
      as(db, admin, 'SELECT public.revoke_shared_viewer_sessions($1)', [
        viewer
      ]),
      /Access denied/
    )
    await db.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$1)', [
      admin
    ])
    await as(db, admin, 'SELECT public.revoke_shared_viewer_sessions($1)', [
      viewer
    ])
    assert.equal(
      (await as(db, viewer, 'SELECT id FROM persons')).rows.length,
      0
    )
    assert.equal(
      (await as(db, viewer, 'SELECT id FROM profiles')).rows.length,
      0
    )
    assert.equal(
      (await as(db, member, 'SELECT id FROM persons')).rows.length,
      1
    )
    assert.equal(
      (
        await db.query<Record<string, unknown>>(
          'SELECT is_active,is_shared_viewer FROM profiles WHERE id=$1',
          [viewer]
        )
      ).rows[0].is_shared_viewer,
      true
    )
    assert.equal(
      (
        await db.query<Record<string, unknown>>(
          "SELECT count(*)::int AS n FROM pg_policies WHERE policyname LIKE 'shared_viewer_no_%' AND schemaname='storage'"
        )
      ).rows[0].n,
      3
    )
  } finally {
    await db.close()
  }
})
