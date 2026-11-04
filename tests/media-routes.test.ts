import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

import sharp from 'sharp'

const require = createRequire(import.meta.url),
  { mock } = require('bun:test')
let active = true,
  allowed = false,
  role = 'editor',
  uploads = 0,
  downloads = 0,
  adminReads = 0,
  failSave = false,
  removed = 0
let saved: Record<string, unknown> | null = null
let storageFailure: { statusCode: string; message: string } | null = null
let lookupFailure: { code: string } | null = null
let path = 'safe.png',
  bucket = 'media-library'
let downloadedBlob = new Blob(['image'], { type: 'image/png' })
mock.module('../utils/supabase/queries', () => ({
  getProfile: async () => ({ is_active: active, role }),
  getSupabase: async () => ({
    rpc: async () => ({ data: allowed, error: null }),
    from: () => {
      let insert: Record<string, unknown> | null = null
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: saved, error: lookupFailure }),
        insert: (value: Record<string, unknown>) => {
          insert = value
          return query
        },
        single: async () => {
          if (failSave) return { data: null, error: { code: '42501' } }
          saved = insert
          return { data: saved, error: null }
        }
      }
      return query
    },
    storage: {
      from: () => ({
        upload: async () => {
          uploads++
          return { error: storageFailure }
        },
        remove: async () => {
          removed++
          return { error: null }
        }
      })
    }
  })
}))
mock.module('../utils/supabase/admin', () => ({
  getAdminSupabase: () => {
    adminReads++
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { storage_path: path, storage_bucket: bucket }
            })
          })
        })
      }),
      storage: {
        from: () => ({
          download: async () => {
            downloads++
            return {
              data: downloadedBlob,
              error: null
            }
          }
        })
      }
    }
  }
}))
const upload = await import('../app/api/media/upload/route'),
  image = await import('../app/api/media/image/route')
const origin = 'https://family.example',
  id = '11111111-1111-4111-8111-111111111111'
const photo = await sharp({
  create: {
    width: 90,
    height: 160,
    channels: 4,
    background: { r: 10, g: 20, b: 30, alpha: 1 }
  }
})
  .png()
  .toBuffer()
function uploadRequest(file: File, headers: Record<string, string> = {}) {
  const form = new FormData()
  form.set('file', file)
  form.set('library_visible', 'false')
  return new Request(`${origin}/api/media/upload`, {
    method: 'POST',
    headers: { origin, ...headers },
    body: form
  })
}

test('shared upload checks active editor/origin/size/type before storage and reads actual image dimensions', async () => {
  const file = new File([photo], 'Portrait.png', { type: 'image/png' })
  active = false
  assert.equal((await upload.POST(uploadRequest(file))).status, 403)
  active = true
  role = 'member'
  assert.equal((await upload.POST(uploadRequest(file))).status, 403)
  role = 'editor'
  assert.equal(
    (
      await upload.POST(
        uploadRequest(file, { origin: 'https://other.example' })
      )
    ).status,
    403
  )
  assert.equal(
    (
      await upload.POST(
        uploadRequest(file, { 'content-length': String(5 * 1024 * 1024) })
      )
    ).status,
    413
  )
  assert.equal(
    (
      await upload.POST(
        uploadRequest(new File([photo], 'fake.jpg', { type: 'image/jpeg' }))
      )
    ).status,
    415
  )
  assert.equal(uploads, 0)
  const response = await upload.POST(uploadRequest(file))
  assert.equal(response.status, 201)
  const result = await response.json()
  assert.equal(result.asset.width, 90)
  assert.equal(result.asset.height, 160)
  assert.equal(result.asset.library_visible, false)
  assert.equal(result.asset.title, 'Portrait')
  assert.equal(uploads, 1)
})

test('identical file uploads reuse the asset and never change its internal/private visibility', async () => {
  const response = await upload.POST(
    uploadRequest(
      new File([photo], 'Different name.png', { type: 'image/png' })
    )
  )
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.reused, true)
  assert.equal(result.asset.title, 'Portrait')
  assert.equal(result.asset.library_visible, false)
  assert.equal(uploads, 1)
  saved = null
  failSave = true
  const failedSave = await upload.POST(
    uploadRequest(new File([photo], 'Failure.png', { type: 'image/png' }))
  )
  assert.equal(failedSave.status, 400)
  assert.equal((await failedSave.json()).error, 'databasePermission')
  assert.equal(removed, 1)
  failSave = false
})

test('shared upload reports Storage and metadata lookup denials separately', async () => {
  const file = new File([photo], 'Denied.png', { type: 'image/png' })
  const before = uploads
  try {
    lookupFailure = { code: '42501' }
    const lookup = await upload.POST(uploadRequest(file))
    assert.equal((await lookup.json()).error, 'databasePermission')
    assert.equal(uploads, before)
    lookupFailure = null
    storageFailure = {
      statusCode: '403',
      message: 'new row violates row-level security policy'
    }
    const storage = await upload.POST(uploadRequest(file))
    assert.equal((await storage.json()).error, 'mediaStoragePermission')
    assert.equal(saved, null)
  } finally {
    lookupFailure = null
    storageFailure = null
  }
})

test('shared image proxy checks permission before service access, validates paths and never caches private bytes', async () => {
  const request = () => new Request(`${origin}/api/media/image?id=${id}`)
  assert.equal((await image.GET(request())).status, 404)
  assert.equal(adminReads, 0)
  allowed = true
  path = '../private.png'
  assert.equal((await image.GET(request())).status, 404)
  assert.equal(downloads, 0)
  path = 'safe.png'
  bucket = 'avatars'
  assert.equal((await image.GET(request())).status, 404)
  assert.equal(downloads, 0)
  bucket = 'media-library'
  const response = await image.GET(request())
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(downloads, 1)
  allowed = false
  assert.equal((await image.GET(request())).status, 404)
  assert.equal(downloads, 1)
})

test('shared image proxy serves unchanged image bytes without Blob MIME and rejects unknown bytes', async () => {
  allowed = true
  try {
    for (const type of [
      '',
      'application/octet-stream',
      'image/png; charset=utf-8'
    ]) {
      downloadedBlob = new Blob([photo], { type })
      const response = await image.GET(
        new Request(`${origin}/api/media/image?id=${id}`)
      )
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-type'), 'image/png')
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), photo)
    }
    downloadedBlob = new Blob(['<svg onload="alert(1)"></svg>'])
    assert.equal(
      (await image.GET(new Request(`${origin}/api/media/image?id=${id}`)))
        .status,
      415
    )
  } finally {
    allowed = false
    downloadedBlob = new Blob(['image'], { type: 'image/png' })
  }
})
