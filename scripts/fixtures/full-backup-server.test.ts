import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { test } from 'node:test'

import {
  decodeWebsiteBackup,
  encodeWebsiteBackup,
  type WebsiteBackup
} from '../../utils/full-backup-archive'
import type { AdminAccountMapping } from '../../utils/full-backup-data'

const { mock } = createRequire(import.meta.url)('bun:test')
const actor = '11111111-1111-4111-8111-111111111111'
const target = 'a'.repeat(20),
  source = 'b'.repeat(20),
  password = 'fictional backup password'
process.env.WEBSITE_BACKUP_ENABLED = 'true'
process.env.WEBSITE_BACKUP_OPERATOR_ID = actor
process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${target}.supabase.co`
process.env.SUPABASE_DB_URL = `postgresql://postgres:fixture@db.${target}.supabase.co:5432/postgres`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_fictional_test_only'
process.env.WEBSITE_BACKUP_SOURCE_PROJECT_REF = source
process.env.WEBSITE_BACKUP_SOURCE_DB_URL = `postgresql://postgres:fixture@db.${source}.supabase.co:5432/postgres`
process.env.WEBSITE_BACKUP_SOURCE_SERVICE_ROLE_KEY =
  'sb_secret_fictional_source_only'
delete process.env.VERCEL
let demo = false,
  fingerprint = 'old-state',
  uploadFailure = false,
  corrupt = false,
  sqlFailure = false,
  ackFailure = false,
  exclusive = true
let adminMapping: AdminAccountMapping | null = null
let bucketLimit: number | undefined, bucketMimes: string[] | undefined
let restoredMapping: AdminAccountMapping | null | undefined
let uploads: Array<{ bucket: string; path: string; upsert: boolean }> = [],
  removed: string[] = [],
  writes = 0,
  connections = 0,
  readOnly = false,
  ends = 0
const image = Buffer.from('fictional image bytes')
const columns = { 'auth.users': [{ name: 'id', type: 'pg_catalog.uuid' }] }
const rows = { 'auth.users': [{ id: actor }] }
const objects = [
  {
    bucket_id: 'media-library',
    name: 'photo.webp',
    metadata: { mimetype: 'image/webp', size: image.length },
    updated_at: '2026-10-22T00:00:00Z'
  }
]
mock.module('../../utils/deployment', () => ({
  getDeploymentConfig: () => ({
    supabaseProjectRef: target,
    isDemo: demo,
    siteName: 'Fictional target'
  }),
  assertDatabaseTarget: () => {}
}))
mock.module('postgres', () => ({
  default: () => {
    connections++
    const sql = {
      unsafe: async (text: string) =>
        text.includes('storage.objects')
          ? objects
          : text.includes('SELECT id FROM public.profiles')
            ? [{ id: actor }]
            : [],
      end: async () => {
        ends++
      },
      begin: async (...args: unknown[]) => {
        if (typeof args[0] === 'string')
          readOnly = String(args[0]).includes('read only')
        const value = await (args.at(-1) as (db: unknown) => Promise<unknown>)(
          sql
        )
        if (ackFailure) throw new Error('commit acknowledgement lost')
        return value
      }
    }
    return sql
  }
}))
mock.module('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      listBuckets: async () => ({
        data: ['avatars', 'gallery', 'home-content', 'media-library'].map(
          (id) => ({
            id,
            public: false,
            file_size_limit: bucketLimit,
            allowed_mime_types: bucketMimes
          })
        ),
        error: null
      }),
      from: (bucket: string) => ({
        upload: async (
          path: string,
          _bytes: unknown,
          options: { upsert: boolean }
        ) => {
          uploads.push({ bucket, path, upsert: options.upsert })
          return { error: uploadFailure ? new Error('fake failure') : null }
        },
        download: async () => ({
          data: new Blob([corrupt ? Buffer.from('bad') : image], {
            type: 'image/webp'
          }),
          error: null
        }),
        remove: async (paths: string[]) => {
          removed.push(...paths)
          return { error: null }
        }
      })
    }
  })
}))
mock.module('../../utils/full-backup-data', () => ({
  getAdminAccountMapping: async () => adminMapping,
  applyAdminAccountMapping: (manifest: WebsiteBackup) =>
    structuredClone(manifest),
  BACKUP_BUCKETS: ['avatars', 'gallery', 'home-content', 'media-library'],
  BACKUP_TABLES: ['auth.users'],
  readBackupSchema: async () => columns,
  readBackupRows: async () => structuredClone(rows),
  referencedBackupPaths: () => new Set(['media-library/photo.webp']),
  stripAuthTokens: () => {},
  validateWebsiteData: () => {},
  assertMatchingSchema: () => {},
  assertNoAccountCollisions: async () => {},
  assertOrdinaryAuth: async () => {},
  assertExclusiveRestoreOperator: async () => {
    if (!exclusive)
      throw new Error('Nơi nhận còn tài khoản khác đang hoạt động.')
  },
  targetFingerprint: async () => fingerprint,
  relocateBackup: (manifest: WebsiteBackup) => ({
    ...structuredClone(manifest),
    files: manifest.files.map((f, i) => ({ ...f, path: `restore-${i}.webp` }))
  }),
  restoreWebsiteRows: async (
    _db: unknown,
    _manifest: unknown,
    _actor: string,
    _crossProject: boolean,
    mapping?: AdminAccountMapping | null
  ) => {
    if (sqlFailure) throw new Error('fixture SQL failure')
    restoredMapping = mapping
    writes++
  }
}))
const server = await import('../../utils/full-backup-server')
async function archive(from = target) {
  const manifest: WebsiteBackup = {
    format: 1,
    createdAt: new Date().toISOString(),
    appVersion: '2.3.0',
    sourceProjectRef: from,
    schema: columns,
    tables: rows,
    files: [
      {
        bucket: 'media-library',
        path: 'photo.webp',
        size: image.length,
        mime: 'image/webp',
        sha256: createHash('sha256').update(image).digest('hex')
      }
    ]
  }
  return encodeWebsiteBackup(manifest, [image], password)
}
function reset() {
  uploads = []
  removed = []
  writes = 0
  connections = 0
  ends = 0
  readOnly = false
  demo = false
  fingerprint = 'old-state'
  uploadFailure = false
  corrupt = false
  sqlFailure = false
  ackFailure = false
  exclusive = true
  adminMapping = null
  restoredMapping = undefined
  bucketLimit = undefined
  bucketMimes = undefined
}

test('external export is read-only, includes bytes, and does not mutate either project', async () => {
  reset()
  // Old recovery objects remain private in Storage, but must not double the
  // archive size or cause the next backup to exceed its byte limit.
  objects.push({
    bucket_id: 'media-library',
    name: 'old-recovery.webp',
    metadata: { mimetype: 'image/webp', size: 128 * 1024 * 1024 },
    updated_at: '2026-10-22T00:00:00Z'
  })
  let bytes: Buffer
  objects.push(
    ...Array.from({ length: 10000 }, (_, i) => ({
      ...objects[1],
      name: `old-recovery-${i}.webp`
    }))
  )
  try {
    bytes = await server.exportWebsiteBackup(password, true)
  } finally {
    objects.splice(1)
  }
  const result = await decodeWebsiteBackup(bytes, password)
  assert.equal(result.manifest.sourceProjectRef, source)
  assert.deepEqual(result.files, [image])
  assert.ok(readOnly)
  assert.equal(connections, 1)
  assert.equal(writes, 0)
  assert.deepEqual(uploads, [])
  assert.equal(ends, 1)
})
test('preview binds encrypted archive, actor and target; stale/changed target stops before upload', async () => {
  reset()
  const bytes = await archive(),
    preview = await server.inspectWebsiteBackup(bytes, password, actor)
  assert.ok(preview.token)
  assert.equal(preview.confirmation, `RESTORE ${target}`)
  await assert.rejects(() =>
    server.restoreWebsiteBackup(
      bytes,
      password,
      actor,
      preview.token,
      'wrong target'
    )
  )
  await assert.rejects(() =>
    server.restoreWebsiteBackup(
      bytes,
      password,
      actor,
      preview.token + 'tampered',
      preview.confirmation
    )
  )
  const changed = await archive(source)
  await assert.rejects(() =>
    server.restoreWebsiteBackup(
      changed,
      password,
      actor,
      preview.token,
      preview.confirmation
    )
  )
  fingerprint = 'changed'
  await assert.rejects(
    () =>
      server.restoreWebsiteBackup(
        bytes,
        password,
        actor,
        preview.token,
        preview.confirmation
      ),
    /đã đổi/
  )
  assert.equal(writes, 0)
  assert.equal(uploads.length, 0)
})
test('demo refuses foreign data and restoration requires an exclusive authorized operator', async () => {
  reset()
  demo = true
  const bytes = await archive(source)
  await assert.rejects(
    () => server.inspectWebsiteBackup(bytes, password, actor),
    /Demo/
  )
  demo = false
  exclusive = false
  await assert.rejects(
    () => server.inspectWebsiteBackup(bytes, password, actor),
    /Nơi nhận/
  )
  await assert.rejects(
    () => server.inspectWebsiteBackup(bytes, password, 'different-admin'),
    /chỉ định/
  )
  assert.equal(uploads.length, 0)
})
test('successful restore verifies bytes, retains original paths and never upserts Storage', async () => {
  reset()
  const bytes = await archive(),
    preview = await server.inspectWebsiteBackup(bytes, password, actor)
  const result = await server.restoreWebsiteBackup(
    bytes,
    password,
    actor,
    preview.token,
    preview.confirmation
  )
  assert.equal(result.success, true)
  assert.equal(writes, 1)
  assert.deepEqual(uploads, [
    { bucket: 'media-library', path: 'restore-0.webp', upsert: false }
  ])
  assert.deepEqual(removed, [])
})

test('preview and restore reject incompatible destination bucket limits before uploads or writes', async () => {
  reset()
  const bytes = await archive()
  const preview = await server.inspectWebsiteBackup(bytes, password, actor)
  for (const issue of ['size', 'mime']) {
    bucketLimit = issue === 'size' ? image.length - 1 : undefined
    bucketMimes = issue === 'mime' ? ['image/png'] : undefined
    await assert.rejects(
      () => server.inspectWebsiteBackup(bytes, password, actor),
      /bucket nơi nhận/
    )
    await assert.rejects(
      () =>
        server.restoreWebsiteBackup(
          bytes,
          password,
          actor,
          preview.token,
          preview.confirmation
        ),
      /bucket nơi nhận/
    )
    assert.equal(writes, 0)
    assert.equal(uploads.length, 0)
  }
  bucketLimit = image.length
  bucketMimes = ['image/*']
  await server.inspectWebsiteBackup(bytes, password, actor)
})
test('upload/corrupt-byte/SQL failures keep database untouched and clean only newly staged paths', async () => {
  for (const failure of ['upload', 'corrupt', 'sql']) {
    reset()
    const bytes = await archive(),
      preview = await server.inspectWebsiteBackup(bytes, password, actor)
    uploadFailure = failure === 'upload'
    corrupt = failure === 'corrupt'
    sqlFailure = failure === 'sql'
    await assert.rejects(() =>
      server.restoreWebsiteBackup(
        bytes,
        password,
        actor,
        preview.token,
        preview.confirmation
      )
    )
    assert.equal(writes, 0)
    assert.deepEqual(removed, failure === 'upload' ? [] : ['restore-0.webp'])
  }
})
test('uncertain COMMIT never removes files that committed database rows may reference', async () => {
  reset()
  const bytes = await archive(),
    preview = await server.inspectWebsiteBackup(bytes, password, actor)
  ackFailure = true
  await assert.rejects(() =>
    server.restoreWebsiteBackup(
      bytes,
      password,
      actor,
      preview.token,
      preview.confirmation
    )
  )
  assert.equal(writes, 1)
  assert.deepEqual(removed, [])
  assert.ok(ends >= 2)
})

test('admin mapping requires consent, is signed into preview and rechecked before any upload', async () => {
  reset()
  adminMapping = {
    sourceId: 'source-admin',
    targetId: actor,
    email: 'admin@example.test'
  }
  const bytes = await archive(source)
  const preview = await server.inspectWebsiteBackup(bytes, password, actor)
  assert.deepEqual(preview.adminMapping, adminMapping)
  const before = connections
  await assert.rejects(
    () =>
      server.restoreWebsiteBackup(
        bytes,
        password,
        actor,
        preview.token,
        preview.confirmation
      ),
    /đồng ý/
  )
  assert.equal(
    connections,
    before,
    'Missing consent must stop before a destination connection'
  )
  assert.equal(writes, 0)
  assert.equal(uploads.length, 0)

  const originalMapping = adminMapping
  adminMapping = { ...adminMapping, sourceId: 'changed-admin' }
  await assert.rejects(
    () =>
      server.restoreWebsiteBackup(
        bytes,
        password,
        actor,
        preview.token,
        preview.confirmation,
        true
      ),
    /ánh xạ admin đã đổi/
  )
  assert.equal(uploads.length, 0)
  assert.equal(writes, 0)

  adminMapping = originalMapping
  const result = await server.restoreWebsiteBackup(
    bytes,
    password,
    actor,
    preview.token,
    preview.confirmation,
    true
  )
  assert.equal(result.adminMapped, true)
  assert.deepEqual(restoredMapping, originalMapping)
  assert.equal(writes, 1)
})
