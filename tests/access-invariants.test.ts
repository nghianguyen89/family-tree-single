import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

import type { WebsiteBackup } from '../utils/full-backup-archive'
import {
  readBackupRows,
  readBackupSchema,
  restoreWebsiteRows,
  type BackupDatabase
} from '../utils/full-backup-data'
import { buildSetupSqlBundle } from '../utils/setup-sql'
import { installAuthSessions } from './helpers/auth-sessions'

const migrationPath = 'docs/migrations/20261029020000_access_invariants.sql'
const migration = readFileSync(migrationPath, 'utf8')
const id = (n: number) =>
  `ad000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [admin, otherAdmin, editor, member, root, branch, object, asset] = [
  1, 2, 3, 4, 10, 11, 12, 13
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
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,created_at timestamptz DEFAULT now());
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
  for (const [user, role] of [
    [admin, 'admin'],
    [otherAdmin, 'admin'],
    [editor, 'editor'],
    [member, 'member']
  ]) {
    await db.query<Record<string, unknown>>(
      'INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',
      [user, `${user}@example.test`]
    )
    await db.query<Record<string, unknown>>(
      'UPDATE profiles SET role=$1::public.user_role_enum,is_active=true WHERE id=$2',
      [role, user]
    )
  }
  await db.query<Record<string, unknown>>(
    "INSERT INTO persons(id,full_name,gender,is_in_law) VALUES($1,'Fictional ancestor','male',true)",
    [root]
  )
  await db.query<Record<string, unknown>>(
    "INSERT INTO family_branches(id,name,anchor_person_id,root_person_id) VALUES($1,'Fictional branch',$2,$2)",
    [branch, root]
  )
  await db.query<Record<string, unknown>>(
    "INSERT INTO storage.objects VALUES($1,'avatars',$2)",
    [object, `${root}.webp`]
  )
  await db.query<Record<string, unknown>>(
    "INSERT INTO media_assets(id,storage_bucket,storage_path,title,library_visible) VALUES($1,'media-library','fictional.webp','Fictional image',true)",
    [asset]
  )
  return db
}

async function as(
  db: PGlite,
  user: string | null,
  sql: string,
  params: unknown[] = [],
  claims?: Record<string, unknown>
) {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`)
    await tx.query<Record<string, unknown>>(
      "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
      [user ?? '', claims === undefined ? '' : JSON.stringify(claims)]
    )
    return tx.query<Record<string, unknown>>(sql, params)
  })
}

test('missing, malformed, revoked and wrong-user session claims fail closed across private boundaries; fresh sessions work', async () => {
  const db = await prepare()
  try {
    const probes = `SELECT private.has_live_session() AS session,public.is_admin() AS admin,
      public.is_active_user() AS active,public.is_editor() AS editor,
      public.can_view_person($1) AS person,public.can_view_family_branch($2) AS branch,
      public.can_edit_family_branch($2) AS edit_branch,public.can_edit_person($1) AS edit_person,
      public.can_read_media_asset($3) AS media`
    const denied = {
      session: false,
      admin: false,
      active: false,
      editor: false,
      person: false,
      branch: false,
      edit_branch: false,
      edit_person: false,
      media: false
    }
    const valid = (await as(db, admin, probes, [root, branch, asset])).rows[0]
    assert.equal(valid.session, true)
    assert.equal(valid.admin, true)
    assert.equal(valid.person, true)
    assert.equal(valid.branch, true)
    assert.equal(valid.edit_branch, true)
    assert.equal(valid.edit_person, true)
    assert.equal(valid.media, true)
    assert.equal(
      (await as(db, editor, 'SELECT public.is_editor() AS allowed')).rows[0]
        .allowed,
      true
    )
    for (const sessionClaim of [
      undefined,
      '',
      id(99),
      'not-a-uuid',
      'ffffffffffffffffffffffffffffffff',
      otherAdmin,
      17,
      {}
    ]) {
      const claims = {
        sub: admin,
        ...(sessionClaim === undefined ? {} : { session_id: sessionClaim })
      }
      assert.deepEqual(
        (await as(db, admin, probes, [root, branch, asset], claims)).rows[0],
        denied
      )
      assert.equal(
        (
          await as(
            db,
            admin,
            'SELECT id FROM profiles WHERE id=$1',
            [admin],
            claims
          )
        ).rows.length,
        0
      )
      assert.equal(
        (await as(db, admin, 'SELECT id FROM persons', [], claims)).rows.length,
        0
      )
      assert.equal(
        (await as(db, admin, 'SELECT id FROM storage.objects', [], claims)).rows
          .length,
        0
      )
      await assert.rejects(
        as(
          db,
          admin,
          'SELECT public.set_user_person($1,NULL)',
          [member],
          claims
        ),
        /Access denied/
      )
      await assert.rejects(
        as(db, admin, 'SELECT public.attach_media_asset($1)', [asset], claims),
        /Access denied/
      )
      await assert.rejects(
        as(db, admin, 'SELECT public.remove_media_asset($1)', [asset], claims),
        /Access denied/
      )
    }
    await db.query<Record<string, unknown>>(
      'DELETE FROM auth.sessions WHERE user_id=$1',
      [admin]
    )
    assert.deepEqual(
      (await as(db, admin, probes, [root, branch, asset])).rows[0],
      denied
    )
    assert.equal(
      (
        await db.query<Record<string, unknown>>(
          'SELECT is_active FROM profiles WHERE id=$1',
          [admin]
        )
      ).rows[0].is_active,
      true
    )
    await db.query<Record<string, unknown>>(
      'INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',
      [id(100), admin]
    )
    const fresh = { sub: admin, session_id: id(100) }
    assert.equal(
      (await as(db, admin, probes, [root, branch, asset], fresh)).rows[0].admin,
      true
    )
    assert.equal(
      (
        await as(
          db,
          admin,
          'SELECT id FROM profiles WHERE id=$1',
          [admin],
          fresh
        )
      ).rows.length,
      1
    )
    assert.equal(
      (await as(db, admin, 'SELECT id FROM storage.objects', [], fresh)).rows
        .length,
      1
    )
    await db.query<Record<string, unknown>>(
      'UPDATE profiles SET is_active=false WHERE id=$1',
      [member]
    )
    assert.equal(
      (
        await as(db, member, 'SELECT is_active FROM profiles WHERE id=$1', [
          member
        ])
      ).rows[0].is_active,
      false
    )
    assert.equal(
      (await as(db, member, 'SELECT id FROM persons')).rows.length,
      0
    )
  } finally {
    await db.close()
  }
})

test('same-project restore restores active profiles but deleted sessions cannot regain private REST, Storage or RPC access', async () => {
  const db = await prepare()
  try {
    const adapter: BackupDatabase = {
      query: async (sql, values = []) =>
        (await db.query<Record<string, unknown>>(sql, values)).rows
    }
    const schema = await readBackupSchema(adapter)
    const manifest: WebsiteBackup = {
      format: 1,
      createdAt: new Date().toISOString(),
      appVersion: '2.3.0',
      sourceProjectRef: 'a'.repeat(20),
      schema,
      tables: await readBackupRows(adapter, schema),
      files: []
    }
    // The operator preflight requires all other accounts to be inactive first.
    await db.query<Record<string, unknown>>(
      'UPDATE profiles SET is_active=false WHERE id<>$1',
      [admin]
    )
    await db.transaction(async (tx) => {
      await restoreWebsiteRows(
        {
          query: async (sql, values = []) =>
            (await tx.query<Record<string, unknown>>(sql, values)).rows
        },
        manifest,
        admin,
        false
      )
    })
    assert.equal(
      (
        await db.query<Record<string, unknown>>(
          'SELECT count(*)::int AS n FROM profiles WHERE is_active'
        )
      ).rows[0].n,
      4
    )
    assert.equal(
      (
        await db.query<Record<string, unknown>>(
          'SELECT count(*)::int AS n FROM auth.sessions'
        )
      ).rows[0].n,
      0
    )
    for (const user of [admin, otherAdmin, editor, member]) {
      assert.equal(
        (await as(db, user, 'SELECT id FROM profiles')).rows.length,
        0
      )
      assert.equal(
        (await as(db, user, 'SELECT id FROM persons')).rows.length,
        0
      )
      assert.equal(
        (await as(db, user, 'SELECT id FROM storage.objects')).rows.length,
        0
      )
      assert.equal(
        (
          await as(
            db,
            user,
            'SELECT public.can_view_family_branch($1) AS allowed',
            [branch]
          )
        ).rows[0].allowed,
        false
      )
    }
    await assert.rejects(
      as(db, admin, 'SELECT public.get_admin_users()'),
      /Access denied/
    )
    await db.query<Record<string, unknown>>(
      'INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',
      [id(101), admin]
    )
    assert.equal(
      (
        await as(db, admin, 'SELECT public.is_admin() AS allowed', [], {
          sub: admin,
          session_id: id(101)
        })
      ).rows[0].allowed,
      true
    )
  } finally {
    await db.close()
  }
})

test('all account-removal RPCs lock before reauthorizing, retain an active admin and preserve authorized mutations', async () => {
  const db = await prepare()
  try {
    for (const [fn, args, mutation] of [
      [
        'set_user_role',
        'uuid,text',
        "SELECT public.set_user_role($1,'member')"
      ],
      [
        'set_user_active_status',
        'uuid,boolean',
        'SELECT public.set_user_active_status($1,false)'
      ],
      ['delete_user', 'uuid', 'SELECT public.delete_user($1)']
    ]) {
      const definition = String(
        (
          await db.query<Record<string, unknown>>(
            'SELECT pg_get_functiondef($1::regprocedure) AS definition',
            [`private.${fn}(${args})`]
          )
        ).rows[0].definition
      )
      const lockPosition = definition.indexOf(
        "pg_advisory_xact_lock(hashtext('family_tree_admin_accounts'))"
      )
      assert.ok(
        lockPosition >= 0 &&
          lockPosition < definition.indexOf('IF NOT public.is_admin()')
      )
      assert.ok(
        definition.includes('Cannot') &&
          definition.includes('last active administrator')
      )
      await assert.rejects(
        as(db, admin, mutation, [admin]),
        /yourself|your own/
      )
      await assert.rejects(
        as(db, member, mutation, [otherAdmin]),
        /Access denied/
      )
      await db.query<Record<string, unknown>>(
        "UPDATE profiles SET role='admin',is_active=true WHERE id=$1",
        [otherAdmin]
      )
      await as(db, admin, mutation, [otherAdmin])
      assert.equal(
        (
          await db.query<Record<string, unknown>>(
            "SELECT count(*)::int AS n FROM profiles WHERE role='admin' AND is_active"
          )
        ).rows[0].n,
        1
      )
      if (fn !== 'delete_user') {
        await assert.rejects(
          as(db, otherAdmin, mutation, [admin]),
          /Access denied/
        )
      }
    }
  } finally {
    await db.close()
  }
})

test('anonymous collection/public images and privileged bootstrap/SQL survive migration replay', async () => {
  const db = await prepare()
  try {
    const token = 'a'.repeat(64)
    await db.query<Record<string, unknown>>(
      "INSERT INTO family_intake_links(token_hash,share_token,title,root_person_id,expires_at,created_by) VALUES(md5($1),$1,'Fictional intake',$2,now()+interval '1 day',$3)",
      [token, root, admin]
    )
    assert.ok(
      (
        await as(
          db,
          null,
          'SELECT public.get_family_intake_options($1) AS data',
          [token]
        )
      ).rows[0].data
    )
    await as(db, null, 'SELECT public.submit_family_intake($1,$2::jsonb)', [
      token,
      JSON.stringify({
        anchor_id: root,
        sender_name: 'Fictional sender',
        sender_contact: 'sender@example.test',
        note: '',
        people: [
          {
            client_id: id(201),
            relation: 'child',
            relative_to: 'anchor',
            data: {
              full_name: 'Fictional child',
              gender: 'male',
              is_deceased: false
            }
          }
        ]
      })
    ])
    await db.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE service_role')
      await tx.query<Record<string, unknown>>(
        "UPDATE home_settings SET title='SQL remains available' WHERE id=1"
      )
      assert.equal(
        (await tx.query<Record<string, unknown>>('SELECT id FROM profiles'))
          .rows.length,
        4
      )
    })
    assert.equal(
      (await as(db, null, 'SELECT title FROM home_settings')).rows[0].title,
      'SQL remains available'
    )
    await db.query<Record<string, unknown>>(
      "INSERT INTO home_content_images(id,asset_id,storage_path,alt) VALUES($1,$2,'fictional.webp','Fictional image')",
      [id(202), asset]
    )
    await db.query<Record<string, unknown>>(
      'UPDATE home_settings SET cover_image_id=$1 WHERE id=1',
      [id(202)]
    )
    assert.equal(
      (
        await as(
          db,
          null,
          'SELECT public.can_read_media_asset($1) AS allowed',
          [asset]
        )
      ).rows[0].allowed,
      true
    )
    await db.exec(migration)
    await db.exec(buildSetupSqlBundle(files))
    assert.equal(
      (await as(db, admin, 'SELECT public.is_admin() AS allowed')).rows[0]
        .allowed,
      true
    )
    const policies = (
      await db.query<{ tablename: string }>(
        "SELECT tablename FROM pg_policies WHERE policyname='live_authenticated_session' ORDER BY tablename"
      )
    ).rows
    assert.ok(
      policies.some((p) => p.tablename === 'profiles') &&
        policies.some((p) => p.tablename === 'objects')
    )
    const unguarded = await db.query<Record<string, unknown>>(
      "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relrowsecurity AND c.relkind IN ('r','p') AND (n.nspname='public' OR (n.nspname='storage' AND c.relname='objects')) AND NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='live_authenticated_session' AND NOT p.polpermissive)"
    )
    assert.deepEqual(unguarded.rows, [])
    // Bootstrap writes profiles directly and has no authenticated JWT/session.
    await db.query<Record<string, unknown>>(
      "UPDATE profiles SET role='member',is_active=false"
    )
    await db.query<Record<string, unknown>>('DELETE FROM auth.sessions')
    await db.exec(
      readFileSync('docs/bootstrap-admin.sql', 'utf8').replace(
        'replace-with-your-verified-email@example.com',
        `${admin}@example.test`
      )
    )
    assert.equal(
      (
        await db.query<Record<string, unknown>>(
          'SELECT role,is_active FROM profiles WHERE id=$1',
          [admin]
        )
      ).rows[0].role,
      'admin'
    )
  } finally {
    await db.close()
  }
})
