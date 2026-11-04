import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

import { NextRequest } from 'next/server'

const require = createRequire(import.meta.url)
const { mock } = require('bun:test')
let user: { id: string } | null = null
let active = false
let admin = false
let imageUrl: string | null = 'photo.png'
let downloads = 0
let adminClients = 0
const id = '33333333-3333-4333-8333-333333333333'
mock.module('../utils/supabase/queries', () => ({
  getUser: async () => user,
  getProfile: async () => ({ is_active: active }),
  getIsAdmin: async () => admin,
  getSupabase: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: imageUrl ? { image_url: imageUrl } : null,
            error: table === 'media_assets' ? { code: '42P01' } : null
          })
        })
      })
    })
  })
}))
mock.module('../utils/supabase/admin', () => ({
  getAdminSupabase: () => {
    adminClients++
    return {
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
    }
  }
}))
const gallery = await import('../app/api/gallery/route')
const approval = await import('../app/api/admin/approve/[token]/route')
const request = () => new Request(`https://family.example/api/gallery?id=${id}`)

test('gallery requires authentication and an active profile before storage access', async () => {
  assert.equal((await gallery.GET(request())).status, 401)
  user = { id }
  assert.equal((await gallery.GET(request())).status, 403)
  assert.equal(downloads, 0)
  active = true
  const response = await gallery.GET(request())
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('content-type'), 'image/png')
  active = false
  assert.equal((await gallery.GET(request())).status, 403)
  assert.equal(downloads, 1)
})

test('gallery rejects invalid id, unknown items, traversal, and external image URLs', async () => {
  active = true
  assert.equal(
    (
      await gallery.GET(
        new Request('https://family.example/api/gallery?id=bad')
      )
    ).status,
    400
  )
  imageUrl = null
  assert.equal((await gallery.GET(request())).status, 404)
  for (const path of ['../secret.png', 'https://attacker.example/track.png']) {
    imageUrl = path
    assert.equal((await gallery.GET(request())).status, 400)
  }
  assert.equal(downloads, 1)
})

test('approval GET and POST deny token holders without an active admin session', async () => {
  const previousAdminClients = adminClients
  const context = { params: Promise.resolve({ token: 'a'.repeat(43) }) }
  const url = 'https://family.example/api/admin/approve/' + 'a'.repeat(43)
  user = null
  assert.equal((await approval.GET(new Request(url), context)).status, 307)
  assert.equal(
    (await approval.POST(new Request(url, { method: 'POST' }), context)).status,
    403
  )
  user = { id }
  admin = false
  assert.equal((await approval.GET(new Request(url), context)).status, 403)
  assert.equal(
    (await approval.POST(new Request(url, { method: 'POST' }), context)).status,
    403
  )
  assert.equal(adminClients, previousAdminClients)
})

let intakeCalls = 0
let intakeError: { message: string; code?: string } | null = null
let intakeArgs: Record<string, unknown> = {}
mock.module('../utils/supabase/public-intake', () => ({
  getPublicIntakeClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, 'submit_family_intake')
      intakeCalls++
      intakeArgs = args
      return { data: id, error: intakeError }
    }
  })
}))
const intake = await import('../app/api/intake/[token]/route')
const intakeToken = 'a'.repeat(64)
const intakeContext = { params: Promise.resolve({ token: intakeToken }) }
const intakeBody = () => ({
  consent: true,
  website: '',
  payload: {
    anchor_id: id,
    sender_name: 'Sender',
    sender_contact: 'sender@example.com',
    note: '',
    people: [
      {
        client_id: '44444444-4444-4444-8444-444444444444',
        relation: 'child',
        relative_to: 'anchor',
        data: { full_name: 'Child', gender: 'male', is_deceased: false },
        existing_person_id: id,
        update_existing: true
      }
    ]
  }
})
function intakeRequest(
  body: unknown = intakeBody(),
  headers: Record<string, string> = {}
) {
  return new NextRequest(`https://family.example/api/intake/${intakeToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
}

test('public intake accepts anonymous submissions through scoped RPC only, strips review flags, and returns a private receipt', async () => {
  user = null
  intakeError = null
  const adminBefore = adminClients
  const response = await intake.POST(intakeRequest(), intakeContext)
  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), { receipt: id })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(adminClients, adminBefore)
  const submission = intakeArgs.submission as {
    people: Array<Record<string, unknown>>
  }
  assert.equal(submission.people[0].existing_person_id, undefined)
  assert.equal(submission.people[0].update_existing, undefined)
})

test('public intake rejects cross-origin, missing consent, honeypot, malformed and oversized requests before database calls', async () => {
  const before = intakeCalls
  assert.equal(
    (
      await intake.POST(
        intakeRequest(undefined, { Origin: 'https://unrelated.example' }),
        intakeContext
      )
    ).status,
    403
  )
  assert.equal(
    (
      await intake.POST(
        intakeRequest({ ...intakeBody(), consent: false }),
        intakeContext
      )
    ).status,
    400
  )
  assert.equal(
    (
      await intake.POST(
        intakeRequest({ ...intakeBody(), website: 'spam' }),
        intakeContext
      )
    ).status,
    400
  )
  assert.equal(
    (await intake.POST(intakeRequest('{'), intakeContext)).status,
    400
  )
  assert.equal(
    (await intake.POST(intakeRequest('x'.repeat(65537)), intakeContext)).status,
    413
  )
  assert.equal(
    (
      await intake.POST(
        intakeRequest(undefined, { 'Content-Type': 'text/plain' }),
        intakeContext
      )
    ).status,
    415
  )
  assert.equal(
    (
      await intake.POST(intakeRequest(), {
        params: Promise.resolve({ token: 'invalid' })
      })
    ).status,
    404
  )
  assert.equal(intakeCalls, before)
})

test('public intake maps database quotas and migration failures without exposing database errors', async () => {
  intakeError = {
    message:
      'Collection limit reached. Please contact the family administrator.'
  }
  assert.equal((await intake.POST(intakeRequest(), intakeContext)).status, 429)
  intakeError = {
    message: 'Raw schema error with internal details',
    code: 'PGRST202'
  }
  const response = await intake.POST(intakeRequest(), intakeContext)
  assert.equal(response.status, 503)
  assert.doesNotMatch(JSON.stringify(await response.json()), /Raw schema error/)
  intakeError = null
})
