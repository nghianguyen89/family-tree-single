import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

import { imageFileProblem, imageFileTitle } from '../utils/image-upload'

const require = createRequire(import.meta.url)
const { mock } = require('bun:test')
const types = ['image/jpeg', 'image/png', 'image/webp']

test('image selection enforces per-image limits and accepts missing MIME/JPEG aliases without allowing SVG or GIF in CMS', () => {
  assert.equal(imageFileProblem(new File(['x'], 'face.jpg'), 10, types), null)
  assert.equal(
    imageFileProblem(
      new File(['x'], 'face.jpg', { type: 'image/pjpeg' }),
      10,
      types
    ),
    null
  )
  assert.equal(
    imageFileProblem(
      new File(['x'], 'fake.png', { type: 'image/svg+xml' }),
      10,
      types
    ),
    'invalid'
  )
  assert.equal(
    imageFileProblem(new File(['x'], 'animated.gif'), 10, types),
    'invalid'
  )
  assert.equal(
    imageFileProblem(new File(['12345678901'], 'face.jpg'), 10, types),
    'size'
  )
  assert.equal(imageFileProblem(new File([], 'face.jpg'), 10, types), 'size')
})

test('temporary image titles are nonempty, bounded and remove filename control characters', () => {
  assert.equal(imageFileTitle(' Họp mặt 2026.jpg'), 'Họp mặt 2026')
  assert.equal(imageFileTitle('\u0000\n.jpg'), 'Image')
  assert.equal(imageFileTitle('x'.repeat(400) + '.png').length, 200)
})

let saveError = false,
  signedIn = true
let uploads = 0
let values: Record<string, unknown>[] = []
let removed: string[] = []
const db = {
  auth: {
    getUser: async () => ({
      data: { user: signedIn ? { id: 'synthetic-admin' } : null },
      error: null
    })
  },
  from: () => {
    const query = {
      insert: (value: Record<string, unknown>) => {
        values.push(value)
        return query
      },
      update: (value: Record<string, unknown>) => {
        values.push(value)
        return query
      },
      eq: () => query,
      select: () => query,
      single: async () => ({
        data: { id: 'synthetic-image' },
        error: saveError ? { message: 'rejected' } : null
      })
    }
    return query
  },
  storage: {
    from: () => ({
      remove: async (paths: string[]) => {
        removed.push(...paths)
        return { error: null }
      }
    })
  }
}
mock.module('../utils/supabase/client', () => ({ createClient: () => db }))
mock.module('../utils/supabase/storage', () => ({
  uploadGalleryImage: async () => {
    uploads++
    return { path: 'new.png', error: null }
  }
}))
const { saveGalleryImage } = await import('../utils/gallery-images')

test('gallery accepts description later; failed metadata saves clean up only the new file and retries can proceed', async () => {
  values = []
  removed = []
  uploads = 0
  const file = new File(['synthetic'], 'Group photo.png', { type: 'image/png' })
  saveError = true
  await assert.rejects(saveGalleryImage(file), /save/)
  assert.deepEqual(removed, ['new.png'])
  saveError = false
  await saveGalleryImage(file)
  assert.equal(values[1].title, 'Group photo')
  assert.equal(values[1].description, null)
  assert.equal(values[1].created_by, 'synthetic-admin')
  signedIn = false
  await assert.rejects(saveGalleryImage(file), /permission/)
  assert.equal(uploads, 2)
  signedIn = true
})

test('editing gallery metadata preserves the file; replacement removes the old file only after success', async () => {
  removed = []
  uploads = 0
  values = []
  const existing = {
    id: 'synthetic-image',
    title: 'Old title',
    description: 'Old description',
    image_url: '/api/gallery?id=synthetic-image',
    storage_path: 'old.png',
    event_date: null,
    created_at: '',
    created_by: null
  }
  await saveGalleryImage(
    null,
    {
      title: 'New title',
      description: 'Detailed description',
      eventDate: '2026-10-15'
    },
    existing
  )
  assert.equal(uploads, 0)
  assert.equal(values[0].image_url, 'old.png')
  assert.deepEqual(removed, [])
  saveError = true
  await assert.rejects(
    saveGalleryImage(new File(['x'], 'new.png'), undefined, existing),
    /save/
  )
  assert.deepEqual(removed, ['new.png'])
  removed = []
  saveError = false
  await saveGalleryImage(new File(['x'], 'new.png'), undefined, existing)
  assert.deepEqual(removed, ['old.png'])
})
