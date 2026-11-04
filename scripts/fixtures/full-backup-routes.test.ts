import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { beforeEach, test } from 'node:test'

import { MAX_BACKUP_BYTES } from '../../utils/full-backup-archive'

const require = createRequire(import.meta.url)
const { mock } = require('bun:test')
const origin = 'https://backup.example.test'
const password = 'fixture-password'
const admin = { id: 'fixture-admin', role: 'admin', is_active: true }
let profile: typeof admin | null = admin
let operatorError: Error | undefined
let serviceError: Error | undefined
let profileCalls = 0
let availabilityCalls = 0
let operators: string[] = []
let exports: unknown[][] = []
let inspections: unknown[][] = []
let restores: unknown[][] = []
const archive = new Uint8Array([1, 2, 3])
const availability = { available: true }
const preview = { token: 'fixture-preview-token', tables: 2 }
const restored = { success: true }

mock.module('../../utils/supabase/queries', () => ({
  getProfile: async () => {
    profileCalls++
    return profile
  }
}))
mock.module('../../utils/full-backup-server', () => ({
  assertBackupOperator: (id: string) => {
    operators.push(id)
    if (operatorError) throw operatorError
  },
  fullBackupAvailability: () => {
    availabilityCalls++
    return availability
  },
  exportWebsiteBackup: async (...args: unknown[]) => {
    exports.push(args)
    if (serviceError) throw serviceError
    return archive
  },
  inspectWebsiteBackup: async (...args: unknown[]) => {
    inspections.push(args)
    if (serviceError) throw serviceError
    return preview
  },
  restoreWebsiteBackup: async (...args: unknown[]) => {
    restores.push(args)
    if (serviceError) throw serviceError
    return restored
  }
}))
const { GET, POST } = await import('../../app/api/website-backup/route')

beforeEach(() => {
  profile = admin
  operatorError = undefined
  serviceError = undefined
  profileCalls = 0
  availabilityCalls = 0
  operators = []
  exports = []
  inspections = []
  restores = []
})

function request(fields: Record<string, string | File> = {}) {
  const form = new FormData()
  for (const [key, value] of Object.entries({
    action: 'export',
    password,
    source: 'current',
    ...fields
  }))
    form.set(key, value)
  return new Request(`${origin}/api/website-backup`, {
    method: 'POST',
    headers: { origin },
    body: form
  })
}

function unreadableRequest(headers: Record<string, string> = {}) {
  const value = new Request(`${origin}/api/website-backup`, {
    method: 'POST',
    headers: { origin, ...headers }
  })
  let reads = 0
  Object.defineProperty(value, 'body', {
    get: () => {
      reads++
      throw new Error('Request body must not be read')
    }
  })
  return { value, reads: () => reads }
}

function noServicesCalled() {
  assert.deepEqual(exports, [])
  assert.deepEqual(inspections, [])
  assert.deepEqual(restores, [])
}

test('GET and POST reject anonymous, editor and inactive admin before service or body access', async () => {
  for (const denied of [
    null,
    { ...admin, role: 'editor' },
    { ...admin, is_active: false }
  ]) {
    profile = denied
    const body = unreadableRequest()
    assert.equal((await GET()).status, 403)
    assert.equal((await POST(body.value)).status, 403)
    assert.equal(body.reads(), 0)
  }
  assert.deepEqual(operators, [])
  assert.equal(availabilityCalls, 0)
  noServicesCalled()
})

test('GET returns admin availability with private no-store headers', async () => {
  const response = await GET()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), availability)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(availabilityCalls, 1)
})

test('POST rejects absent or foreign Origin before profile and body access', async () => {
  for (const suppliedOrigin of [undefined, 'https://foreign.example.test']) {
    const body = unreadableRequest()
    if (suppliedOrigin) body.value.headers.set('origin', suppliedOrigin)
    else body.value.headers.delete('origin')
    assert.equal((await POST(body.value)).status, 403)
    assert.equal(body.reads(), 0)
  }
  assert.equal(profileCalls, 0)
  assert.deepEqual(operators, [])
  noServicesCalled()
})

test('operator authorization precedes body access for every POST action', async () => {
  operatorError = new Error('Tài khoản chưa được cấp quyền sao lưu.')
  const body = unreadableRequest()
  const response = await POST(body.value)
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: operatorError.message })
  assert.equal(body.reads(), 0)
  assert.deepEqual(operators, [admin.id])
  noServicesCalled()
})

test('declared oversized content-length is rejected before reading the body', async () => {
  const body = unreadableRequest({
    'content-length': String(MAX_BACKUP_BYTES + 65536 + 1)
  })
  assert.equal((await POST(body.value)).status, 413)
  assert.equal(body.reads(), 0)
  assert.deepEqual(operators, [admin.id])
  noServicesCalled()
})

test('export validates source and password bounds before invoking export', async () => {
  const invalidFields: Record<string, string>[] = [
    { source: 'untrusted' },
    { source: '' },
    { password: 'x'.repeat(11) },
    { password: 'x'.repeat(257) }
  ]
  for (const fields of invalidFields)
    assert.equal((await POST(request(fields))).status, 400)
  noServicesCalled()
})

test('export forwards accepted sources and password bounds and downloads an uncached binary', async () => {
  for (const [source, length] of [
    ['current', 12],
    ['external', 256]
  ] as const) {
    const response = await POST(
      request({ source, password: 'x'.repeat(length) })
    )
    assert.equal(response.status, 200)
    assert.equal(
      response.headers.get('content-type'),
      'application/octet-stream'
    )
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.match(
      response.headers.get('content-disposition') || '',
      /^attachment; filename="family-website-\d{4}-\d{2}-\d{2}\.ftbackup"$/
    )
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), archive)
  }
  assert.deepEqual(exports, [
    ['x'.repeat(12), false],
    ['x'.repeat(256), true]
  ])
  assert.deepEqual(operators, [admin.id, admin.id])
})

test('inspect preview token and restore confirmation are forwarded for an authorized operator', async () => {
  const file = new File([archive], 'fixture.ftbackup')
  const inspected = await POST(request({ action: 'inspect', file }))
  assert.equal(inspected.status, 200)
  assert.deepEqual(await inspected.json(), preview)
  assert.equal(inspected.headers.get('cache-control'), 'private, no-store')
  const confirmation = 'RESTORE fixture-project'
  const response = await POST(
    request({ action: 'restore', file, token: preview.token, confirmation })
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), restored)
  assert.deepEqual(inspections, [[archive, password, admin.id]])
  assert.deepEqual(restores, [
    [archive, password, admin.id, preview.token, confirmation, false]
  ])
  assert.deepEqual(operators, [admin.id, admin.id])
})

test('restore forwards admin mapping consent only for the literal true value', async () => {
  const file = new File([archive], 'fixture.ftbackup')
  for (const value of ['true', 'false', 'yes']) {
    restores = []
    const response = await POST(
      request({
        action: 'restore',
        file,
        token: preview.token,
        confirmation: 'RESTORE fixture-project',
        acceptAdminMapping: value
      })
    )
    assert.equal(response.status, 200)
    assert.equal(restores[0][5], value === 'true')
  }
})

test('inspect and restore reject missing or empty files; unknown actions never call services', async () => {
  for (const action of ['inspect', 'restore']) {
    assert.equal((await POST(request({ action }))).status, 400)
    assert.equal(
      (await POST(request({ action, file: new File([], 'empty.ftbackup') })))
        .status,
      400
    )
  }
  assert.equal((await POST(request({ action: 'unknown' }))).status, 400)
  noServicesCalled()
})

test('internal SQL and credential errors are redacted from responses', async () => {
  serviceError = new Error(
    'postgresql://fixture:secret-password@db.example.test/postgres SELECT password_hash FROM auth.users service_role=fixture-secret'
  )
  const response = await POST(request())
  assert.equal(response.status, 400)
  const text = await response.text()
  assert.match(JSON.parse(text).error, /^Không thể xử lý bản sao lưu\./)
  assert.doesNotMatch(
    text,
    /postgresql|secret-password|SELECT|password_hash|service_role|fixture-secret/
  )
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
})
