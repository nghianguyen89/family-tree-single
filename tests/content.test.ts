import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

import type { ContentInput } from '../types/content'
import {
  contentImageMime,
  toContentDate,
  toContentLocal,
  validateContent,
  validateHomeSettings
} from '../utils/content'
import { installAuthSessions } from './helpers/auth-sessions'

const db = new PGlite()
const admin = '11111111-1111-4111-8111-111111111111',
  editor = '22222222-2222-4222-8222-222222222222',
  member = '33333333-3333-4333-8333-333333333333',
  pending = '44444444-4444-4444-8444-444444444444'
const article = '55555555-5555-4555-8555-555555555555',
  internal = '66666666-6666-4666-8666-666666666666',
  image = '77777777-7777-4777-8777-777777777777',
  cover = '88888888-8888-4888-8888-888888888888'
const migration = readFileSync(
  'docs/migrations/20261015000000_home_content.sql',
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
before(async () => {
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
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
  await db.exec(
    readFileSync('docs/schema.sql', 'utf8').replace(
      'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;',
      ''
    )
  )
  for (const f of readdirSync('docs/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(readFileSync(`docs/migrations/${f}`, 'utf8'))
  for (const [id, role, active] of [
    [admin, 'admin', true],
    [editor, 'editor', true],
    [member, 'member', true],
    [pending, 'admin', false]
  ] as const) {
    await db.query('INSERT INTO auth.users VALUES ($1,$2,now())', [
      id,
      `${role}-${id.slice(0, 4)}@example.com`
    ])
    await db.query(
      'UPDATE profiles SET role=$1::public.user_role_enum,is_active=$2 WHERE id=$3',
      [role, active, id]
    )
  }
  await asUser(
    editor,
    "INSERT INTO home_content(id,kind,title,status,visibility,publish_at) VALUES ($1,'article','Public story','published','public',now()-interval '1 hour'),($2,'album','Private album','published','internal',now()-interval '1 hour')",
    [article, internal]
  )
  await asUser(
    editor,
    "INSERT INTO home_content_images(id,entry_id,storage_path,alt) VALUES ($1::uuid,$2::uuid,$1::text || '.jpg','Public image'),($3::uuid,NULL,$3::text || '.jpg','Homepage cover')",
    [image, article, cover]
  )
})
after(async () => {
  await db.close()
})

test('public readers see only live public content; active members also see internal publications', async () => {
  await asUser(
    editor,
    "INSERT INTO home_content(kind,title,status,visibility,publish_at,expires_at) VALUES ('article','Draft','draft','public',NULL,NULL),('article','Future','published','public',now()+interval '1 day',NULL),('article','Expired','published','public',now()-interval '2 days',now()-interval '1 day')"
  )
  const publicRows = await asUser(
    null,
    'SELECT title FROM home_content ORDER BY title'
  )
  assert.deepEqual(
    publicRows.rows.map((r) => r.title),
    ['Public story']
  )
  assert.equal(
    (await asUser(member, 'SELECT id FROM home_content')).rows.length,
    2
  )
  assert.equal(
    (await asUser(pending, 'SELECT id FROM home_content')).rows.length,
    1
  )
  assert.equal(
    (await asUser(editor, 'SELECT id FROM home_content')).rows.length,
    5
  )
})

test('members, pending admins and anonymous callers cannot manage content or settings', async () => {
  for (const user of [null, member, pending]) {
    await assert.rejects(() =>
      asUser(
        user,
        "INSERT INTO home_content(kind,title) VALUES ('article','Forbidden')"
      )
    )
    await assert.rejects(() =>
      asUser(
        user,
        "INSERT INTO home_content_images(storage_path,alt) VALUES ('99999999-9999-4999-8999-999999999999.jpg','Forbidden')"
      )
    )
    if (user) {
      assert.equal(
        (
          await asUser(
            user,
            "UPDATE home_content SET title='Forbidden' WHERE id=$1 RETURNING id",
            [article]
          )
        ).rows.length,
        0
      )
      assert.equal(
        (
          await asUser(
            user,
            "UPDATE home_settings SET title='Forbidden' RETURNING id"
          )
        ).rows.length,
        0
      )
    } else
      await assert.rejects(() =>
        asUser(null, "UPDATE home_settings SET title='Forbidden'")
      )
  }
  assert.equal(
    (
      await asUser(
        admin,
        "UPDATE home_content SET summary='Admin edit' WHERE id=$1 RETURNING id",
        [article]
      )
    ).rows.length,
    1
  )
})

test('image visibility follows its parent and only the selected standalone cover is public', async () => {
  assert.equal(
    (
      await asUser(null, 'SELECT id FROM home_content_images WHERE id=$1', [
        cover
      ])
    ).rows.length,
    0
  )
  await asUser(
    editor,
    'UPDATE home_settings SET cover_image_id=$1 WHERE id=1',
    [cover]
  )
  assert.equal(
    (
      await asUser(null, 'SELECT id FROM home_content_images WHERE id=$1', [
        cover
      ])
    ).rows.length,
    1
  )
  await assert.rejects(
    () => asUser(editor, 'UPDATE home_settings SET cover_image_id=$1', [image]),
    /standalone/
  )
  await asUser(
    editor,
    "UPDATE home_content SET visibility='internal' WHERE id=$1",
    [article]
  )
  assert.equal(
    (
      await asUser(null, 'SELECT id FROM home_content_images WHERE id=$1', [
        image
      ])
    ).rows.length,
    0
  )
  assert.equal(
    (
      await asUser(member, 'SELECT id FROM home_content_images WHERE id=$1', [
        image
      ])
    ).rows.length,
    1
  )
  await asUser(
    editor,
    "UPDATE home_content SET visibility='public' WHERE id=$1",
    [article]
  )
})

test('trash hides publications and images; restoration returns to draft, preserving assets', async () => {
  const before = await asUser(
    editor,
    'SELECT revision FROM home_content WHERE id=$1',
    [article]
  )
  const revision = Number(before.rows[0].revision)
  await asUser(
    editor,
    'UPDATE home_content SET deleted_at=now() WHERE id=$1 AND revision=$2',
    [article, revision]
  )
  assert.equal(
    (await asUser(null, 'SELECT id FROM home_content WHERE id=$1', [article]))
      .rows.length,
    0
  )
  assert.equal(
    (
      await asUser(member, 'SELECT id FROM home_content_images WHERE id=$1', [
        image
      ])
    ).rows.length,
    0
  )
  assert.equal(
    (
      await asUser(editor, 'SELECT id FROM home_content_images WHERE id=$1', [
        image
      ])
    ).rows.length,
    1
  )
  assert.equal(
    (
      await asUser(
        editor,
        "UPDATE home_content SET title='Stale edit' WHERE id=$1 AND revision=$2 RETURNING id",
        [article, revision]
      )
    ).rows.length,
    0
  )
  const restored = await asUser(
    editor,
    "UPDATE home_content SET deleted_at=NULL,status='published' WHERE id=$1 RETURNING status,revision,updated_by",
    [article]
  )
  assert.equal(restored.rows[0].status, 'draft')
  assert.equal(restored.rows[0].revision, revision + 2)
  assert.equal(restored.rows[0].updated_by, editor)
  await assert.rejects(() =>
    asUser(editor, 'UPDATE home_content SET created_by=$1 WHERE id=$2', [
      admin,
      article
    ])
  )
  assert.equal(
    (
      await asUser(null, 'SELECT id FROM home_content_images WHERE id=$1', [
        image
      ])
    ).rows.length,
    0
  )
})

test('private storage rejects public/member direct reads and permits active editors', async () => {
  await asUser(
    editor,
    "INSERT INTO storage.objects(id,bucket_id,name) VALUES ($1,'home-content','test.jpg')",
    [image]
  )
  for (const user of [null, member, pending])
    assert.equal(
      (
        await asUser(
          user,
          "SELECT id FROM storage.objects WHERE bucket_id='home-content'"
        )
      ).rows.length,
      0
    )
  assert.equal(
    (
      await asUser(
        editor,
        "SELECT id FROM storage.objects WHERE bucket_id='home-content'"
      )
    ).rows.length,
    1
  )
  assert.equal(
    (
      await db.query<{ public: boolean }>(
        "SELECT public FROM storage.buckets WHERE id='home-content'"
      )
    ).rows[0].public,
    false
  )
})

test('origin addresses preserve independent multiline values, editor permissions and migration replay', async () => {
  const current = 'Thôn minh họa\nXã mới, tỉnh mới'
  const previous = 'Thôn minh họa\nXã cũ, huyện cũ, tỉnh cũ'
  const settings = (
    await asUser(
      editor,
      'UPDATE home_settings SET origin=$1, origin_previous=$2 WHERE id=1 RETURNING *',
      [current, previous]
    )
  ).rows[0]
  assert.equal(validateHomeSettings(settings), true)
  assert.equal(
    validateHomeSettings({ ...settings, origin_previous: 'x'.repeat(301) }),
    false
  )
  assert.equal(
    (
      await asUser(
        member,
        'UPDATE home_settings SET origin_previous=$1 RETURNING id',
        ['Forbidden']
      )
    ).rows.length,
    0
  )
  await assert.rejects(() =>
    asUser(editor, 'UPDATE home_settings SET origin_previous=$1', [
      'x'.repeat(301)
    ])
  )
  await db.exec(
    readFileSync(
      'docs/migrations/20261019020000_home_origin_previous.sql',
      'utf8'
    )
  )
  const publicSettings = (
    await asUser(
      null,
      'SELECT origin,origin_previous FROM home_settings WHERE id=1'
    )
  ).rows[0]
  assert.deepEqual(publicSettings, {
    origin: current,
    origin_previous: previous
  })
  await asUser(editor, "UPDATE home_settings SET origin_previous='' WHERE id=1")
  assert.equal(
    (await asUser(null, 'SELECT origin FROM home_settings WHERE id=1')).rows[0]
      .origin,
    current
  )
})

test('database enforces event/schedule constraints and migration replay preserves editorial data', async () => {
  await assert.rejects(() =>
    asUser(
      editor,
      "INSERT INTO home_content(kind,title,status,publish_at) VALUES ('announcement','Missing date','published',now())"
    )
  )
  await assert.rejects(() =>
    asUser(
      editor,
      "UPDATE home_settings SET section_order=ARRAY['articles','articles','albums']"
    )
  )
  const before = await db.query('SELECT * FROM home_content ORDER BY id')
  await db.exec(migration)
  assert.deepEqual(
    (await db.query('SELECT * FROM home_content ORDER BY id')).rows,
    before.rows
  )
  // Deleting an author must not break FK cleanup or delete published content.
  await db.query('DELETE FROM auth.users WHERE id=$1', [editor])
  assert.equal(
    (
      await db.query<{ created_by: string | null }>(
        'SELECT created_by FROM home_content WHERE id=$1',
        [article]
      )
    ).rows[0].created_by,
    null
  )
})

test('editorial validation and time conversion reject invalid schedules and unsafe image types', () => {
  const base: ContentInput = {
    kind: 'article',
    title: 'Story',
    summary: '',
    body: '',
    category: 'news',
    status: 'draft',
    visibility: 'internal',
    is_featured: false,
    publish_at: null,
    expires_at: null,
    event_start: null,
    event_end: null,
    location: ''
  }
  assert.equal(validateContent(base), true)
  assert.equal(validateContent({ ...base, status: 'published' }), false)
  assert.equal(validateContent({ ...base, visibility: 'everyone' }), false)
  assert.equal(validateContent({ ...base, event_start: 'invalid' }), false)
  assert.equal(
    validateContent({
      ...base,
      kind: 'announcement',
      status: 'published',
      publish_at: '2026-10-15T00:00:00Z'
    }),
    false
  )
  assert.equal(
    validateHomeSettings({
      title: 'Family',
      subtitle: '',
      origin: '',
      introduction: '',
      contact: '',
      cover_image_id: null,
      section_order: ['articles', 'articles', 'albums']
    }),
    false
  )
  assert.equal(toContentDate('2026-10-15T09:00'), '2026-10-15T02:00:00.000Z')
  assert.equal(toContentLocal('2026-10-15T02:00:00.000Z'), '2026-10-15T09:00')
  assert.equal(
    contentImageMime(new TextEncoder().encode('<svg onload="alert(1)"></svg>')),
    null
  )
  assert.equal(
    contentImageMime(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
    'image/png'
  )
})
