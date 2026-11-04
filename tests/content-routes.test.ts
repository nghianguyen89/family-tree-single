import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { mock } = require('bun:test')
const id = '33333333-3333-4333-8333-333333333333'
let active = false,
  role = 'member',
  visible = false,
  downloads = 0,
  uploads = 0,
  dbCalls = 0
let storagePath = `${id}.png`
let storageError: { statusCode: string; message: string } | null = null
let databaseError: { code: string; message: string } | null = null
mock.module('../utils/supabase/queries', () => ({
  getUser: async () => null,
  getIsAdmin: async () => false,
  getProfile: async () => ({ is_active: active, role }),
  getSupabase: async () => {
    dbCalls++
    return {
      from: () => {
        let inserted: Record<string, unknown> | null = null
        const query = {
          select: () => query,
          eq: () => query,
          is: () => query,
          insert: (value: Record<string, unknown>) => {
            inserted = value
            return query
          },
          maybeSingle: async () => ({
            data: visible ? { id, storage_path: storagePath } : null,
            error: null
          }),
          single: async () => ({ data: inserted, error: null }),
          then: (resolve: (v: unknown) => void) =>
            resolve({ count: 0, error: databaseError })
        }
        return query
      },
      storage: {
        from: () => ({
          upload: async () => {
            uploads++
            return { error: storageError }
          },
          remove: async () => ({ error: null })
        })
      }
    }
  }
}))
mock.module('../utils/supabase/admin', () => ({
  getAdminSupabase: () => ({
    storage: {
      from: () => ({
        download: async () => {
          downloads++
          return {
            data: new Blob(['image'], { type: 'image/png' }),
            error: null
          }
        }
      })
    }
  })
}))
const imageRoute = await import('../app/api/content/image/route')
const uploadRoute = await import('../app/api/content/upload/route')
const origin = 'https://family.example'

test('image proxy checks metadata RLS and path before privileged download and disables caching', async () => {
  const request = () => new Request(`${origin}/api/content/image?id=${id}`)
  assert.equal((await imageRoute.GET(request())).status, 404)
  assert.equal(downloads, 0)
  visible = true
  for (const bad of ['../private.png', 'https://attacker.example/photo.jpg']) {
    storagePath = bad
    assert.equal((await imageRoute.GET(request())).status, 404)
  }
  assert.equal(downloads, 0)
  storagePath = `${id}.png`
  const response = await imageRoute.GET(request())
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(downloads, 1)
  // A relocated legacy CMS file must still satisfy this proxy's filename contract.
  const { relocateBackup } = await import('../utils/full-backup-data')
  const relocated = relocateBackup({
    tables: {
      'public.persons': [],
      'public.media_assets': [],
      'public.home_content_images': [
        { storage_path: `${id}.png`, asset_id: null }
      ],
      'public.gallery_items': []
    },
    files: [
      {
        bucket: 'home-content',
        path: `${id}.png`,
        size: 0,
        mime: 'image/png',
        sha256: '0'.repeat(64)
      }
    ]
  } as unknown as import('../utils/full-backup-archive').WebsiteBackup)
  storagePath = String(
    relocated.tables['public.home_content_images'][0].storage_path
  )
  assert.equal((await imageRoute.GET(request())).status, 200)
})

test('uploads accept empty browser MIME based on the PNG signature and report infrastructure failures precisely', async () => {
  role = 'editor'
  active = true
  const submit = async (type: string) => {
    const form = new FormData()
    form.set(
      'file',
      new File(
        [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
        'photo.png',
        { type }
      )
    )
    form.set('alt', 'Image description')
    return uploadRoute.POST(
      new Request('http://localhost:3000/api/content/upload', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' },
        body: form
      })
    )
  }
  assert.equal((await submit('')).status, 201)
  storageError = { statusCode: '404', message: 'Bucket not found' }
  assert.equal((await (await submit('image/png')).json()).error, 'bucket')
  storageError = {
    statusCode: '403',
    message: 'new row violates row-level security policy'
  }
  assert.equal(
    (await (await submit('image/png')).json()).error,
    'storagePermission'
  )
  storageError = null
  databaseError = { code: 'PGRST205', message: 'not found' }
  assert.equal((await (await submit('image/png')).json()).error, 'schema')
  databaseError = null
})

test('uploads reject unauthorized roles, cross-origin requests and oversized streams before database/storage writes', async () => {
  const initialDbCalls = dbCalls
  const initialUploads = uploads
  const request = () =>
    new Request(`${origin}/api/content/upload`, {
      method: 'POST',
      headers: { origin }
    })
  for (const [r, a] of [
    ['member', true],
    ['admin', false],
    ['editor', false]
  ] as const) {
    role = r
    active = a
    assert.equal((await uploadRoute.POST(request())).status, 403)
  }
  role = 'editor'
  active = true
  assert.equal(
    (
      await uploadRoute.POST(
        new Request(`${origin}/api/content/upload`, {
          method: 'POST',
          headers: { origin: 'https://other.example' }
        })
      )
    ).status,
    403
  )
  const oversized = new Request(`${origin}/api/content/upload`, {
    method: 'POST',
    headers: { origin, 'content-type': 'multipart/form-data; boundary=x' },
    body: new Blob([new Uint8Array(4 * 1024 * 1024 + 65537)]).stream(),
    duplex: 'half'
  } as RequestInit)
  assert.equal((await uploadRoute.POST(oversized)).status, 413)
  assert.equal(dbCalls, initialDbCalls)
  assert.equal(uploads, initialUploads)
})

test('uploads reject forged image types and persist valid editor uploads with immutable generated paths', async () => {
  const initialUploads = uploads
  role = 'editor'
  active = true
  const submit = async (bytes: Uint8Array) => {
    const form = new FormData()
    form.set('alt', 'Family gathering')
    form.set(
      'file',
      new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' })
    )
    return uploadRoute.POST(
      new Request(`${origin}/api/content/upload`, {
        method: 'POST',
        headers: { origin },
        body: form
      })
    )
  }
  assert.equal(
    (await submit(new TextEncoder().encode('<svg onload="alert(1)"></svg>')))
      .status,
    415
  )
  assert.equal(uploads, initialUploads)
  const response = await submit(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  )
  assert.equal(response.status, 201)
  const result = await response.json()
  assert.match(result.image.storage_path, /^[0-9a-f-]{36}\.png$/)
  assert.equal(result.image.alt, 'Family gathering')
  assert.equal(uploads, initialUploads + 1)
})
