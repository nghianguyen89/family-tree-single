import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const editor = '11111111-1111-4111-8111-111111111111',
  member = '22222222-2222-4222-8222-222222222222',
  pending = '33333333-3333-4333-8333-333333333333'
const legacyGallery = '44444444-4444-4444-8444-444444444444',
  legacyImage = '55555555-5555-4555-8555-555555555555',
  albumA = '66666666-6666-4666-8666-666666666666',
  albumB = '77777777-7777-4777-8777-777777777777',
  privateAsset = '88888888-8888-4888-8888-888888888888'
const migration = readFileSync(
  'docs/migrations/20261015010000_shared_media_library.sql',
  'utf8'
)
async function asUser(user: string | null, sql: string, args: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`)
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
      user || ''
    ])
    return tx.query<Record<string, unknown>>(sql, args)
  })
}
async function canRead(user: string | null, asset: string) {
  return (
    await asUser(user, 'SELECT public.can_read_media_asset($1) AS allowed', [
      asset
    ])
  ).rows[0].allowed
}
before(async () => {
  await db.exec(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;CREATE SCHEMA auth;CREATE SCHEMA storage;CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA storage TO anon,authenticated;GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO anon,authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`)
  await db.exec(
    readFileSync('docs/schema.sql', 'utf8').replace(
      'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;',
      ''
    )
  )
  for (const file of readdirSync('docs/migrations')
    .filter(
      (file) =>
        file.endsWith('.sql') &&
        file < '20261015010000_shared_media_library.sql'
    )
    .sort())
    await db.exec(readFileSync(`docs/migrations/${file}`, 'utf8'))
  for (const [id, role, active] of [
    [editor, 'editor', true],
    [member, 'member', true],
    [pending, 'editor', false]
  ]) {
    await db.query('INSERT INTO auth.users VALUES($1,$2,now())', [
      id,
      `${id}@example.com`
    ])
    await db.query(
      'UPDATE profiles SET role=$1::public.user_role_enum,is_active=$2 WHERE id=$3',
      [role, active, id]
    )
  }
  await db.query(
    "INSERT INTO gallery_items(id,title,image_url,description) VALUES($1,'Legacy portrait','legacy.png','Existing caption')",
    [legacyGallery]
  )
  await asUser(
    editor,
    "INSERT INTO home_content(id,kind,title) VALUES($1,'album','Album A'),($2,'album','Album B')",
    [albumA, albumB]
  )
  await asUser(
    editor,
    "INSERT INTO home_content_images(id,entry_id,storage_path,alt) VALUES($1::uuid,$2::uuid,$1::text||'.png','Private draft image')",
    [legacyImage, albumA]
  )
  await db.exec(migration)
  await db.exec(
    readFileSync(
      'docs/migrations/20261016010000_fix_media_insert_returning.sql',
      'utf8'
    )
  )
  await asUser(
    editor,
    "INSERT INTO media_assets(id,storage_bucket,storage_path,title,library_visible) VALUES($1,'media-library','private.png','Shared photo',false)",
    [privateAsset]
  )
})
after(() => db.close())

test('editor can insert an asset and return its metadata in the same statement used by upload', async () => {
  // Reproduce the policy shown in the reported SQL screenshot before upgrading.
  await db.exec(`DROP POLICY media_assets_read ON public.media_assets;
    CREATE POLICY media_assets_read ON public.media_assets FOR SELECT TO authenticated
    USING (public.is_active_user() AND public.can_read_media_asset(id));`)
  await assert.rejects(
    asUser(
      editor,
      "INSERT INTO media_assets(storage_bucket,storage_path,title) VALUES('media-library','returning-before-fix.png','Before fix') RETURNING id,title"
    ),
    /row-level security/
  )
  await db.exec(
    readFileSync(
      'docs/migrations/20261016010000_fix_media_insert_returning.sql',
      'utf8'
    )
  )
  const result = await asUser(
    editor,
    "INSERT INTO media_assets(storage_bucket,storage_path,title) VALUES('media-library','returning-regression.png','Returning regression') RETURNING id,title"
  )
  assert.equal(result.rows[0].title, 'Returning regression')
  await asUser(editor, 'SELECT public.remove_media_asset($1)', [
    result.rows[0].id
  ])
  for (const user of [null, member, pending]) {
    await assert.rejects(
      asUser(
        user,
        "INSERT INTO media_assets(storage_bucket,storage_path,title) VALUES('media-library','denied-returning.png','Denied') RETURNING id,title"
      )
    )
  }
})

test('migration imports old files without moving them and never makes draft assets public', async () => {
  const assets = (
    await db.query<{ storage_bucket: string; storage_path: string }>(
      'SELECT storage_bucket,storage_path FROM media_assets ORDER BY storage_bucket'
    )
  ).rows
  assert.equal(assets.length, 3)
  assert.ok(
    assets.some(
      (asset) =>
        asset.storage_bucket === 'gallery' &&
        asset.storage_path === 'legacy.png'
    )
  )
  assert.equal(await canRead(null, legacyGallery), false)
  assert.equal(await canRead(member, legacyGallery), true)
  const link = (
    await db.query<{ asset_id: string }>(
      'SELECT asset_id FROM home_content_images WHERE id=$1',
      [legacyImage]
    )
  ).rows[0]
  assert.equal(await canRead(member, link.asset_id), false)
  assert.equal(await canRead(editor, link.asset_id), true)
  await assert.rejects(asUser(null, 'SELECT title FROM media_assets'))
})

test('one asset can be reused in multiple albums; attaching twice is idempotent and replay does not create phantom files', async () => {
  const a = await asUser(
    editor,
    'SELECT (public.attach_media_asset($1,$2)).id AS id',
    [privateAsset, albumA]
  )
  const again = await asUser(
    editor,
    'SELECT (public.attach_media_asset($1,$2)).id AS id',
    [privateAsset, albumA]
  )
  assert.equal(a.rows[0].id, again.rows[0].id)
  await asUser(editor, 'SELECT public.attach_media_asset($1,$2)', [
    privateAsset,
    albumB
  ])
  const before = (
    await db.query<{ n: number }>('SELECT count(*)::int AS n FROM media_assets')
  ).rows[0].n
  await db.exec(migration)
  assert.equal(
    (
      await db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM media_assets'
      )
    ).rows[0].n,
    before
  )
  assert.equal(
    (
      await db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM home_content_images WHERE asset_id=$1',
        [privateAsset]
      )
    ).rows[0].n,
    2
  )
})

test('public access follows live placements and the saved homepage cover, including expiry, trash and unpublishing', async () => {
  assert.equal(await canRead(null, privateAsset), false)
  await asUser(
    editor,
    "UPDATE home_content SET status='published',visibility='public',publish_at=now()-interval '1 hour' WHERE id=$1",
    [albumA]
  )
  assert.equal(await canRead(null, privateAsset), true)
  await asUser(
    editor,
    "UPDATE home_content SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [albumA]
  )
  assert.equal(await canRead(null, privateAsset), false)
  await asUser(
    editor,
    "UPDATE home_content SET expires_at=NULL,status='draft' WHERE id=$1",
    [albumA]
  )
  const cover = (
    await asUser(
      editor,
      'SELECT (public.attach_media_asset($1,NULL)).id AS id',
      [privateAsset]
    )
  ).rows[0].id
  await asUser(editor, 'UPDATE home_settings SET cover_image_id=$1', [cover])
  assert.equal(await canRead(null, privateAsset), true)
  await asUser(editor, 'UPDATE home_settings SET cover_image_id=NULL')
  assert.equal(await canRead(null, privateAsset), false)
})

test('deleting in-use assets is blocked; detaching an album preserves the other placement and original file', async () => {
  await assert.rejects(
    asUser(editor, 'SELECT public.remove_media_asset($1)', [privateAsset]),
    /in use/
  )
  await asUser(
    editor,
    'DELETE FROM home_content_images WHERE asset_id=$1 AND entry_id=$2',
    [privateAsset, albumA]
  )
  assert.equal(
    (
      await db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM home_content_images WHERE asset_id=$1 AND entry_id IS NOT NULL',
        [privateAsset]
      )
    ).rows[0].n,
    1
  )
  await assert.rejects(
    asUser(editor, 'SELECT public.remove_media_asset($1)', [privateAsset]),
    /in use/
  )
  await asUser(
    editor,
    'DELETE FROM home_content_images WHERE asset_id=$1 AND entry_id=$2',
    [privateAsset, albumB]
  )
  const removed = await asUser(
    editor,
    'SELECT * FROM public.remove_media_asset($1)',
    [privateAsset]
  )
  assert.equal(removed.rows[0].storage_path, 'private.png')
  assert.equal(await canRead(editor, privateAsset), false)
})

test('members and inactive editors cannot attach/delete assets or bypass metadata/storage permissions', async () => {
  for (const user of [member, pending]) {
    await assert.rejects(
      asUser(user, 'SELECT public.attach_media_asset($1,$2)', [
        legacyGallery,
        albumA
      ]),
      /Access denied/
    )
    await assert.rejects(
      asUser(user, 'SELECT public.remove_media_asset($1)', [legacyGallery]),
      /Access denied/
    )
    await assert.rejects(
      asUser(
        user,
        "INSERT INTO media_assets(storage_bucket,storage_path,title) VALUES('media-library','forbidden.png','Forbidden')"
      )
    )
    assert.equal(
      (
        await asUser(
          user,
          "UPDATE media_assets SET title='Forbidden' WHERE id=$1 RETURNING id",
          [legacyGallery]
        )
      ).rows.length,
      0
    )
    assert.equal(
      (
        await asUser(
          user,
          "SELECT name FROM storage.objects WHERE bucket_id='media-library'"
        )
      ).rows.length,
      0
    )
  }
  await assert.rejects(
    asUser(editor, 'DELETE FROM media_assets WHERE id=$1', [legacyGallery])
  )
  await db.query(
    "INSERT INTO media_assets(storage_bucket,storage_path,title) VALUES('media-library','protected.png','Protected')"
  )
  await db.query(
    "INSERT INTO storage.objects(id,bucket_id,name) VALUES(gen_random_uuid(),'media-library','protected.png')"
  )
  assert.equal(
    (
      await asUser(
        editor,
        "DELETE FROM storage.objects WHERE bucket_id='media-library' AND name='protected.png' RETURNING id"
      )
    ).rows.length,
    0
  )
})
