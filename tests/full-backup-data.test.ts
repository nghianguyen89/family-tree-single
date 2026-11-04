import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'
import postgres from 'postgres'

import type { WebsiteBackup } from '../utils/full-backup-archive'
import {
  applyAdminAccountMapping,
  assertMatchingSchema,
  assertNoAccountCollisions,
  assertOrdinaryAuth,
  BACKUP_TABLES,
  getAdminAccountMapping,
  readBackupRows,
  readBackupSchema,
  referencedBackupPaths,
  relocateBackup,
  restoreWebsiteRows,
  stripAuthTokens,
  targetFingerprint,
  validateWebsiteData,
  type BackupDatabase
} from '../utils/full-backup-data'
import { installAuthSessions } from './helpers/auth-sessions'

const uid = (n: number) =>
  `ac000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sourceAdmin = uid(1),
  targetAdmin = uid(2),
  member = uid(3),
  root = uid(10),
  anchor = uid(11),
  parent = uid(12),
  branch = uid(20),
  article = uid(30),
  asset = uid(31),
  image = uid(32),
  link = uid(40)
const bundle = [
  readFileSync('docs/schema.sql', 'utf8').replace(
    'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;',
    ''
  ),
  ...readdirSync('docs/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(`docs/migrations/${f}`, 'utf8'))
].join('\n')
// Match the production driver's JSONB wire serializer, including string parameters.
const jsonbSerializer = postgres().options.serializers[3802] as (
  value: unknown
) => string
const adapter = (db: PGlite): BackupDatabase => ({
  query: async (text, values = []) =>
    (
      await db.query<Record<string, unknown>>(text, values, {
        serializers: { 3802: jsonbSerializer }
      })
    ).rows
})
async function prepare(db: PGlite, admin: string, email: string) {
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text UNIQUE,phone text,role text DEFAULT 'authenticated',encrypted_password text,confirmation_token text DEFAULT '',email_confirmed_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE auth.identities(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),provider text,provider_id text,identity_data jsonb,UNIQUE(provider,provider_id));
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id));
    CREATE TABLE auth.refresh_tokens(id int PRIMARY KEY,user_id text); CREATE TABLE auth.mfa_factors(id uuid PRIMARY KEY,user_id uuid);
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text,metadata jsonb,updated_at timestamptz DEFAULT now());
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage TO anon,authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO anon,authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`)
  await installAuthSessions(db)
  await db.exec(bundle)
  await db.query(
    'INSERT INTO auth.users(id,email,encrypted_password,email_confirmed_at) VALUES($1,$2,$3,now())',
    [admin, email, '$2a$10$fictional-password-hash']
  )
  await db.query(
    "UPDATE profiles SET role='admin',is_active=true WHERE id=$1",
    [admin]
  )
}
async function snapshot(db: PGlite): Promise<WebsiteBackup> {
  const schema = await readBackupSchema(adapter(db)),
    tables = await readBackupRows(adapter(db), schema)
  stripAuthTokens(tables)
  return {
    format: 1,
    createdAt: new Date().toISOString(),
    appVersion: '2.3.0',
    sourceProjectRef: 'a'.repeat(20),
    schema,
    tables,
    files: []
  }
}

test('same-project restore recovers operator profile linkage and metadata from the backup', async () => {
  const db = new PGlite()
  try {
    await prepare(db, sourceAdmin, 'operator@example.test')
    await db.query(
      "INSERT INTO persons(id,full_name,gender) VALUES($1,'Fictional operator','female')",
      [root]
    )
    await db.query(
      'UPDATE profiles SET person_id=$1,created_at=$2 WHERE id=$3',
      [root, '2020-01-02T03:04:05Z', sourceAdmin]
    )
    const backup = await snapshot(db)
    const omitted = structuredClone(backup)
    delete omitted.tables['public.profiles'][0].person_id
    assert.throws(
      () => validateWebsiteData(omitted),
      'Missing nullable columns must not silently become null'
    )
    await db.query(
      'UPDATE profiles SET person_id=NULL,created_at=$1 WHERE id=$2',
      ['2026-01-01T00:00:00Z', sourceAdmin]
    )
    await db.exec('BEGIN')
    await restoreWebsiteRows(adapter(db), backup, sourceAdmin, false)
    await db.exec('COMMIT')
    const result = await snapshot(db)
    assert.deepEqual(
      result.tables['public.profiles'],
      backup.tables['public.profiles']
    )
    assert.equal(result.tables['public.profiles'][0].role, 'admin')
    assert.equal(result.tables['public.profiles'][0].is_active, true)
  } finally {
    await db.close()
  }
})

test('same-email admin mapping preserves destination login and source website metadata without mutating the archive', async () => {
  const a = new PGlite(),
    b = new PGlite()
  try {
    await prepare(a, sourceAdmin, 'admin@example.test')
    await prepare(b, targetAdmin, 'ADMIN@example.test')
    await a.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
      sourceAdmin
    ])
    await a.query(
      "INSERT INTO auth.users(id,email,encrypted_password) VALUES($1,'member@example.test','member-hash')",
      [member]
    )
    await a.query(
      "INSERT INTO auth.identities VALUES($1,$2,'email','admin@example.test','{}'),($3,$4,'email','member@example.test','{}')",
      [uid(4), sourceAdmin, uid(5), member]
    )
    await b.query(
      "UPDATE auth.users SET encrypted_password='destination-password',confirmation_token='destination-token' WHERE id=$1",
      [targetAdmin]
    )
    await b.query(
      "INSERT INTO auth.identities VALUES($1,$2,'email','ADMIN@example.test','{\"credential\":\"destination\"}')",
      [uid(6), targetAdmin]
    )
    await b.query('INSERT INTO auth.refresh_tokens VALUES(1,$1)', [targetAdmin])
    await a.query(
      "INSERT INTO persons(id,full_name,gender) VALUES($1,'Fictional admin person','female')",
      [root]
    )
    await a.query(
      'UPDATE profiles SET person_id=$1,created_at=$2 WHERE id=$3',
      [root, '2020-01-02T03:04:05Z', sourceAdmin]
    )
    await a.query(
      "INSERT INTO custom_events(id,name,event_date,created_by) VALUES($1,'Fictional admin event','2026-10-25',$2),($3,'Fictional member event','2026-10-26',$4)",
      [uid(23), sourceAdmin, uid(24), member]
    )
    await a.query(
      "INSERT INTO home_content(id,kind,title,body,created_by,updated_by) VALUES($1,'article','Fictional article',$2,$3,$3)",
      [article, sourceAdmin, sourceAdmin]
    )
    await a.query(
      "INSERT INTO family_intake_links(id,token_hash,title,root_person_id,expires_at,created_by) VALUES($1,md5('fictional-link'),'Fictional collection',$2,now()+interval '1 day',$3)",
      [link, root, sourceAdmin]
    )
    await a.query(
      "INSERT INTO family_intake_submissions(id,link_id,payload,status,reviewed_by) VALUES($1,$2,'{}','rejected',$3)",
      [uid(41), link, sourceAdmin]
    )
    await a.query(
      "INSERT INTO user_approval_requests(id,user_id,email,token_hash,expires_at) VALUES($1,$2,'admin@example.test','fictional-admin-approval',now()+interval '1 day')",
      [uid(42), sourceAdmin]
    )
    const original = await snapshot(a)
    validateWebsiteData(original)
    const before = structuredClone(original)
    const destinationAuth = (
      await b.query('SELECT * FROM auth.users WHERE id=$1', [targetAdmin])
    ).rows
    const destinationIdentities = (
      await b.query('SELECT * FROM auth.identities WHERE user_id=$1', [
        targetAdmin
      ])
    ).rows
    const destinationSessions = (
      await b.query('SELECT * FROM auth.sessions WHERE user_id=$1', [
        targetAdmin
      ])
    ).rows
    await assert.rejects(
      () => assertNoAccountCollisions(adapter(b), original),
      /trùng/
    )
    const mapping = await getAdminAccountMapping(
      adapter(b),
      original,
      targetAdmin
    )
    assert.ok(mapping)
    assert.equal(mapping.sourceId, sourceAdmin)
    assert.equal(mapping.targetId, targetAdmin)
    assert.equal(mapping.email.toLowerCase(), 'admin@example.test')
    const mapped = applyAdminAccountMapping(original, mapping)
    assert.deepEqual(
      original,
      before,
      'Mapping must not modify the uploaded archive'
    )
    assert.deepEqual(
      mapped.tables['auth.users'],
      original.tables['auth.users'].filter((u) => u.id !== sourceAdmin)
    )
    assert.deepEqual(
      mapped.tables['auth.identities'],
      original.tables['auth.identities'].filter(
        (i) => i.user_id !== sourceAdmin
      )
    )
    assert.deepEqual(
      mapped.tables['public.profiles'].find((p) => p.id === targetAdmin),
      {
        ...original.tables['public.profiles'].find((p) => p.id === sourceAdmin),
        id: targetAdmin
      }
    )
    assert.equal(
      mapped.tables['public.user_approval_requests'][0].user_id,
      targetAdmin
    )
    assert.equal(
      mapped.tables['public.home_content'][0].body,
      sourceAdmin,
      'Only account references are remapped; text content stays verbatim'
    )
    for (const table of BACKUP_TABLES.filter((t) => t.startsWith('public.'))) {
      for (let i = 0; i < original.tables[table].length; i++) {
        for (const key of ['created_by', 'updated_by', 'reviewed_by']) {
          const value = original.tables[table][i][key]
          assert.equal(
            mapped.tables[table][i][key],
            value === sourceAdmin ? targetAdmin : value,
            `${table}.${key}`
          )
        }
      }
    }
    await assertNoAccountCollisions(adapter(b), mapped)
    await b.exec('BEGIN')
    await restoreWebsiteRows(adapter(b), mapped, targetAdmin, true, mapping)
    await b.exec('COMMIT')
    const restored = await snapshot(b)
    assert.deepEqual(
      restored.tables['public.profiles'].find((p) => p.id === targetAdmin),
      mapped.tables['public.profiles'].find((p) => p.id === targetAdmin),
      'Keep incoming admin person linkage and profile metadata'
    )
    assert.deepEqual(
      restored.tables['public.persons'],
      original.tables['public.persons']
    )
    assert.deepEqual(
      restored.tables['public.custom_events'],
      mapped.tables['public.custom_events']
    )
    assert.deepEqual(
      restored.tables['public.home_content'],
      mapped.tables['public.home_content']
    )
    assert.equal(
      restored.tables['public.family_intake_submissions'][0].reviewed_by,
      targetAdmin
    )
    assert.equal(
      restored.tables['public.user_approval_requests'][0].user_id,
      targetAdmin
    )
    assert.deepEqual(
      (await b.query('SELECT * FROM auth.users WHERE id=$1', [targetAdmin]))
        .rows,
      destinationAuth
    )
    assert.deepEqual(
      (
        await b.query('SELECT * FROM auth.identities WHERE user_id=$1', [
          targetAdmin
        ])
      ).rows,
      destinationIdentities
    )
    assert.deepEqual(
      (
        await b.query('SELECT * FROM auth.sessions WHERE user_id=$1', [
          targetAdmin
        ])
      ).rows,
      destinationSessions
    )
    assert.equal(
      (
        await b.query<{ user_id: string }>(
          'SELECT user_id FROM auth.refresh_tokens WHERE id=1'
        )
      ).rows[0].user_id,
      targetAdmin
    )
    assert.equal(
      restored.tables['auth.users'].some((u) => u.id === sourceAdmin),
      false
    )
    assert.equal(
      restored.tables['auth.identities'].some((i) => i.user_id === sourceAdmin),
      false
    )
    assert.deepEqual(
      restored.tables['auth.users'].find((u) => u.id === member),
      original.tables['auth.users'].find((u) => u.id === member)
    )
    assert.deepEqual(
      restored.tables['auth.identities'].find((i) => i.user_id === member),
      original.tables['auth.identities'].find((i) => i.user_id === member)
    )
    assert.deepEqual(
      restored.tables['public.profiles'].find((p) => p.id === member),
      original.tables['public.profiles'].find((p) => p.id === member)
    )
    assert.deepEqual(
      (await snapshot(a)).tables,
      original.tables,
      'Restore must not write to the source database'
    )
  } finally {
    await a.close()
    await b.close()
  }
})

test('admin mapping requires verified active administrators and refuses ambiguous source accounts', async () => {
  const a = new PGlite(),
    b = new PGlite()
  try {
    await prepare(a, sourceAdmin, 'admin@example.test')
    await prepare(b, targetAdmin, 'admin@example.test')
    const original = await snapshot(a)
    for (const patch of [{ role: 'member' }, { is_active: false }]) {
      const incoming = structuredClone(original)
      Object.assign(incoming.tables['public.profiles'][0], patch)
      assert.equal(
        await getAdminAccountMapping(adapter(b), incoming, targetAdmin),
        null
      )
      await assert.rejects(
        () => assertNoAccountCollisions(adapter(b), incoming),
        /trùng/
      )
    }
    const unverified = structuredClone(original)
    unverified.tables['auth.users'][0].email_confirmed_at = null
    assert.equal(
      await getAdminAccountMapping(adapter(b), unverified, targetAdmin),
      null
    )
    await assert.rejects(
      () => assertNoAccountCollisions(adapter(b), unverified),
      /trùng/
    )
    for (const change of [
      "UPDATE profiles SET role='member'",
      'UPDATE profiles SET is_active=false',
      'UPDATE auth.users SET email_confirmed_at=NULL'
    ]) {
      await b.exec('BEGIN')
      await b.exec(change)
      assert.equal(
        await getAdminAccountMapping(adapter(b), original, targetAdmin),
        null
      )
      await assert.rejects(
        () => assertNoAccountCollisions(adapter(b), original),
        /trùng/
      )
      await b.exec('ROLLBACK')
    }
    const contained = structuredClone(original)
    contained.tables['auth.users'].push({
      ...contained.tables['auth.users'][0],
      id: targetAdmin,
      email: 'other@example.test'
    })
    const ambiguous = structuredClone(original)
    ambiguous.tables['auth.users'].push({
      ...ambiguous.tables['auth.users'][0],
      id: member,
      email: 'ADMIN@example.test'
    })
    ambiguous.tables['public.profiles'].push({
      ...ambiguous.tables['public.profiles'][0],
      id: member
    })
    await assert.rejects(() =>
      getAdminAccountMapping(adapter(b), contained, targetAdmin)
    )
    await assert.rejects(() =>
      getAdminAccountMapping(adapter(b), ambiguous, targetAdmin)
    )
    assert.equal(
      await getAdminAccountMapping(adapter(a), original, sourceAdmin),
      null,
      'Same-ID restore needs no mapping'
    )
  } finally {
    await a.close()
    await b.close()
  }
})

test('full website restore preserves all business tables, password hashes, authors, branches and links with transaction rollback', async () => {
  const a = new PGlite(),
    b = new PGlite()
  try {
    await prepare(a, sourceAdmin, 'source@example.test')
    await prepare(b, targetAdmin, 'target@example.test')
    await a.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
      sourceAdmin
    ])
    await a.query(
      "INSERT INTO auth.users(id,email,encrypted_password,confirmation_token) VALUES($1,'member@example.test','member-hash','one-time-secret')",
      [member]
    )
    await a.query(
      "INSERT INTO auth.identities VALUES($1,$2,'email','source@example.test','{}')",
      [uid(4), sourceAdmin]
    )
    await a.query(
      "INSERT INTO persons(id,full_name,gender,birth_year_from,birth_year_to,generation,avatar_url) VALUES($1,'Fictional ancestor','male',1880,1885,1,$2)",
      [root, `${root}_avatar.webp`]
    )
    await a.query(
      "INSERT INTO persons(id,full_name,gender,is_in_law,generation) VALUES($1,'Fictional spouse','female',true,1)",
      [anchor]
    )
    await a.query(
      "INSERT INTO relationships(id,type,person_a,person_b) VALUES($1,'marriage',$2,$3)",
      [uid(21), root, anchor]
    )
    await a.query(
      "INSERT INTO family_branches(id,name,anchor_person_id,partner_person_id) VALUES($1,'Fictional branch',$2,$3)",
      [branch, anchor, root]
    )
    await a.query(
      "INSERT INTO persons(id,full_name,gender,family_branch_id) VALUES($1,'Fictional branch parent','male',$2)",
      [parent, branch]
    )
    await a.query(
      'UPDATE family_branch_members SET generation=CASE WHEN person_id=$1 THEN 1 ELSE 2 END WHERE branch_id=$2',
      [parent, branch]
    )
    await a.query('UPDATE family_branches SET root_person_id=$1 WHERE id=$2', [
      parent,
      branch
    ])
    await a.query(
      "INSERT INTO relationships(id,type,person_a,person_b,family_branch_id) VALUES($1,'biological_child',$2,$3,$4)",
      [uid(22), parent, anchor, branch]
    )
    await a.query(
      "INSERT INTO person_details_private(person_id,occupation) VALUES($1,'Fictional occupation')",
      [root]
    )
    await a.query('UPDATE profiles SET person_id=$1 WHERE id=$2', [
      root,
      sourceAdmin
    ])
    await a.query(
      "INSERT INTO custom_events(id,name,event_date,created_by) VALUES($1,'Fictional event','2026-10-25',$2)",
      [uid(23), sourceAdmin]
    )
    await a.query(
      "INSERT INTO gallery_items(id,title,image_url,created_by) VALUES($1,'Fictional legacy image','legacy.webp',$2)",
      [uid(24), sourceAdmin]
    )
    await a.query(
      "INSERT INTO home_content(id,kind,title,status,visibility,publish_at,body) VALUES($1,'album','Fictional album','published','public',now(),'Fictional body')",
      [article]
    )
    await a.query(
      "INSERT INTO media_assets(id,storage_bucket,storage_path,title,library_visible,created_by) VALUES($1,'media-library','photo.webp','Fictional photo',true,$2)",
      [asset, sourceAdmin]
    )
    await a.query(
      "INSERT INTO home_content_images(id,entry_id,asset_id,storage_path,alt) VALUES($1,$2,$3,'photo.webp','Fictional photo')",
      [image, article, asset]
    )
    await a.query(
      "INSERT INTO home_content_images(id,entry_id,asset_id,storage_path,alt) VALUES($1,NULL,$2,'photo.webp','Fictional cover')",
      [uid(33), asset]
    )
    await a.query(
      "UPDATE home_settings SET title='Fictional site',introduction='Edited introduction',cover_image_id=$1 WHERE id=1",
      [uid(33)]
    )
    await a.query(
      "INSERT INTO family_intake_links(id,token_hash,share_token,title,root_person_id,is_active,expires_at,created_by) VALUES($1,md5($2),$2,'Fictional collection',$3,true,now()+interval '1 day',$4)",
      [link, 'a'.repeat(64), root, sourceAdmin]
    )
    await a.query(
      "INSERT INTO family_intake_submissions(id,link_id,payload,status) VALUES($1,$2,$3,'pending')",
      [
        uid(41),
        link,
        JSON.stringify({
          sender_name: 'Fictional sender',
          sender_contact: 'fake@example.test',
          anchor_id: root,
          people: []
        })
      ]
    )
    await a.query(
      "INSERT INTO user_approval_requests(id,user_id,email,token_hash,expires_at) VALUES($1,$2,'member@example.test','fictional-approval-hash',now()+interval '1 day')",
      [uid(42), member]
    )
    const original = await snapshot(a)
    validateWebsiteData(original)
    assert.equal(
      original.tables['auth.users'].find((u) => u.id === member)
        ?.confirmation_token,
      ''
    )
    assertMatchingSchema(original.schema, await readBackupSchema(adapter(b)))
    original.schema['public.persons'].reverse()
    assertMatchingSchema(original.schema, await readBackupSchema(adapter(b)))
    const incompatible = structuredClone(original.schema)
    incompatible['public.persons'][0].type = 'pg_catalog.text'
    assert.throws(() => assertMatchingSchema(incompatible, original.schema))
    incompatible['public.persons'] = original.schema['public.persons'].slice(1)
    assert.throws(() => assertMatchingSchema(incompatible, original.schema))
    await assertOrdinaryAuth(adapter(a))
    await assertNoAccountCollisions(adapter(b), original)
    original.files = [
      {
        bucket: 'avatars',
        path: `${root}_avatar.webp`,
        size: 0,
        sha256: '0'.repeat(64),
        mime: 'image/webp'
      },
      {
        bucket: 'gallery',
        path: 'legacy.webp',
        size: 0,
        sha256: '0'.repeat(64),
        mime: 'image/webp'
      },
      {
        bucket: 'media-library',
        path: 'photo.webp',
        size: 0,
        sha256: '0'.repeat(64),
        mime: 'image/webp'
      }
    ]
    const relocated = relocateBackup(original)
    assert.deepEqual(
      [...referencedBackupPaths(original)].sort(),
      original.files.map((f) => `${f.bucket}/${f.path}`).sort(),
      'Only images referenced by website rows belong in the archive'
    )
    assert.ok(
      String(
        relocated.tables['public.persons'].find((p) => p.id === root)
          ?.avatar_url
      ).startsWith(`${root}_restore-`)
    )
    const old = await targetFingerprint(adapter(b))
    await b.exec('BEGIN')
    await restoreWebsiteRows(adapter(b), relocated, targetAdmin, true)
    await b.exec('COMMIT')
    assert.notEqual(await targetFingerprint(adapter(b)), old)
    const restored = await snapshot(b)
    for (const table of BACKUP_TABLES) {
      if (
        [
          'public.profiles',
          'auth.users',
          'public.family_intake_links',
          'public.user_approval_requests'
        ].includes(table)
      )
        continue
      assert.deepEqual(
        restored.tables[table].sort((x, y) =>
          JSON.stringify(x).localeCompare(JSON.stringify(y))
        ),
        relocated.tables[table].sort((x, y) =>
          JSON.stringify(x).localeCompare(JSON.stringify(y))
        ),
        table
      )
    }
    assert.equal(
      restored.tables['auth.users'].find((u) => u.id === sourceAdmin)
        ?.encrypted_password,
      '$2a$10$fictional-password-hash'
    )
    assert.equal(
      restored.tables['public.profiles'].find((u) => u.id === targetAdmin)
        ?.role,
      'admin'
    )
    // Exercise replacement of an already populated destination, including
    // circular branch references and previously imported Auth identities.
    await b.query('UPDATE auth.identities SET id=$1 WHERE user_id=$2', [
      uid(80),
      sourceAdmin
    ])
    await b.query(
      "INSERT INTO auth.identities VALUES($1,$2,'google','later-provider','{}')",
      [uid(81), sourceAdmin]
    )
    await assertNoAccountCollisions(adapter(b), relocated)
    await b.exec('BEGIN')
    await restoreWebsiteRows(adapter(b), relocated, targetAdmin, true)
    await b.exec('COMMIT')
    assert.deepEqual(
      (await snapshot(b)).tables['public.persons'],
      restored.tables['public.persons']
    )
    assert.deepEqual(
      (await snapshot(b)).tables['auth.identities'],
      restored.tables['auth.identities'],
      'Restore replaces relinked identities and removes providers added after backup'
    )
    assert.equal(
      restored.tables['public.profiles'].find((u) => u.id === sourceAdmin)
        ?.person_id,
      root
    )
    assert.equal(
      restored.tables['public.family_intake_links'][0].is_active,
      false
    )
    assert.ok(restored.tables['public.user_approval_requests'][0].used_at)
    const stable = await targetFingerprint(adapter(b))
    const broken = structuredClone(relocated)
    broken.tables['public.home_content_images'][0].asset_id = uid(999)
    await b.exec('BEGIN')
    await assert.rejects(() =>
      restoreWebsiteRows(adapter(b), broken, targetAdmin, true)
    )
    await b.exec('ROLLBACK')
    assert.equal(
      await targetFingerprint(adapter(b)),
      stable,
      'A failed database restore must preserve the old site'
    )
    assert.equal(
      (await a.query<{ title: string }>('SELECT title FROM home_settings'))
        .rows[0].title,
      'Fictional site',
      'Source remains unchanged'
    )
    // The restore must also restore the metadata stamp triggers after commit/rollback.
    await b.query(
      "UPDATE home_content SET title='Edited after restore' WHERE id=$1",
      [article]
    )
    assert.equal(
      (
        await b.query<{ revision: number }>(
          'SELECT revision FROM home_content WHERE id=$1',
          [article]
        )
      ).rows[0].revision,
      Number(original.tables['public.home_content'][0].revision) + 1
    )
    await b
      .query(
        "INSERT INTO auth.users(id,email) VALUES($1,'source@example.test')",
        [uid(99)]
      )
      .catch(() => {})
    const collision = structuredClone(original)
    collision.tables['auth.users'][0].id = uid(98)
    await assert.rejects(
      () => assertNoAccountCollisions(adapter(b), collision),
      /trùng/
    )
    await b.query('INSERT INTO auth.mfa_factors VALUES($1,$2)', [
      uid(97),
      sourceAdmin
    ])
    await assert.rejects(() => assertOrdinaryAuth(adapter(b)), /MFA/)
    const wrong = structuredClone(original)
    wrong.tables['public.family_branch_members'] = []
    assert.throws(() => validateWebsiteData(wrong))
    const injected = structuredClone(original)
    injected.tables['auth.sessions'] = []
    assert.throws(() => validateWebsiteData(injected))
    const badAnchor = structuredClone(original)
    badAnchor.tables['public.persons'].find((p) => p.id === anchor)!.is_in_law =
      false
    assert.throws(
      () => validateWebsiteData(badAnchor),
      'Restoring must retain the anchor in-law invariant'
    )
    const badMainRelationship = structuredClone(original)
    badMainRelationship.tables['public.relationships'].find(
      (r) => r.person_a === parent
    )!.family_branch_id = null
    assert.throws(
      () => validateWebsiteData(badMainRelationship),
      'Branch-owned people must not enter main relationships'
    )
    const badCover = structuredClone(original)
    badCover.tables['public.home_settings'][0].cover_image_id = image
    assert.throws(
      () => validateWebsiteData(badCover),
      'Album placements must not become standalone public covers'
    )
    const badHash = structuredClone(original)
    badHash.tables['public.media_assets'][0].content_hash = 'f'.repeat(64)
    assert.throws(() => relocateBackup(badHash), /hash/)
  } finally {
    await a.close()
    await b.close()
  }
})
