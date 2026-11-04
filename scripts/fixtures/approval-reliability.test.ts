import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const { mock } = createRequire(import.meta.url)('bun:test')
type Row = Record<string, unknown>
let row: Row | null = null
let cleanupFails = false
let failure: 'network' | 'http' | null = null
let sends = 0
let isAdmin = true
let user: { id: string } | null = { id: 'admin' }
let rpcStatus = 'approved'
let rpcError = false
let rpcCalls = 0
let observedHash = ''

function query() {
  let operation = 'select'
  let values: Row = {}
  const filters: Array<[string, unknown]> = []
  const execute = () => {
    const matches = row && filters.every(([key, value]) => row?.[key] === value)
    if (operation === 'select')
      return { data: matches ? { ...row } : null, error: null }
    if (operation === 'delete') {
      if (cleanupFails) throw new Error('Cleanup unavailable')
      if (matches) row = null
      return { data: null, error: null }
    }
    if ((operation === 'insert' && row) || (operation === 'update' && !matches))
      return { data: null, error: null }
    row = { id: 'request', ...row, ...values }
    return { data: { ...row }, error: null }
  }
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => {
      filters.push([key, value])
      return builder
    },
    is: (key: string, value: unknown) => {
      filters.push([key, value])
      return builder
    },
    upsert: (next: Row) => {
      operation = 'insert'
      values = next
      return builder
    },
    update: (next: Row) => {
      operation = 'update'
      values = next
      return builder
    },
    delete: () => {
      operation = 'delete'
      return builder
    },
    maybeSingle: async () => execute(),
    then: <TResult1 = ReturnType<typeof execute>, TResult2 = never>(
      resolve?:
        | ((
            value: ReturnType<typeof execute>
          ) => TResult1 | PromiseLike<TResult1>)
        | null,
      reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) => Promise.resolve().then(execute).then(resolve, reject)
  }
  return builder
}

mock.module('server-only', () => ({}))
mock.module('../../utils/deployment', () => ({
  getDeploymentConfig: () => ({ appUrl: 'https://family.example' })
}))
mock.module('../../utils/supabase/queries', () => ({
  getUser: async () => user,
  getIsAdmin: async () => isAdmin
}))
mock.module('../../utils/supabase/admin', () => ({
  getAdminSupabase: () => ({
    from: () => query(),
    rpc: async (name: string, args: { p_token_hash: string }) => {
      assert.equal(name, 'approve_pending_user')
      observedHash = args.p_token_hash
      rpcCalls++
      return {
        data: { status: rpcStatus, email: '<pending>@example.test' },
        error: rpcError ? new Error('Transient RPC error') : null
      }
    }
  })
}))
const { notifyAdminOfPendingUser } =
  await import('../../utils/approval-notification')
const approval = await import('../../app/api/admin/approve/[token]/route')
process.env.RESEND_API_KEY = 'fixture-key'
process.env.RESEND_FROM_EMAIL = 'fixture@example.test'
process.env.ADMIN_NOTIFICATION_EMAIL = 'admin@example.test'
const previousFetch = globalThis.fetch
globalThis.fetch = (async () => {
  sends++
  if (failure === 'network') throw new Error('Network unavailable')
  return new Response('', { status: failure === 'http' ? 503 : 200 })
}) as typeof fetch
const pending = { id: 'pending-user', email: 'pending@example.test' }

test('network and HTTP failures clear the claim and permit retry; success suppresses duplicate emails', async () => {
  try {
    for (const mode of ['network', 'http'] as const) {
      row = null
      failure = mode
      assert.equal(
        (await notifyAdminOfPendingUser(pending)).reason,
        'email_send_failed'
      )
      assert.equal(row, null)
      failure = null
      assert.equal((await notifyAdminOfPendingUser(pending)).sent, true)
      const before = sends
      assert.equal(
        (await notifyAdminOfPendingUser(pending)).reason,
        'already_notified'
      )
      assert.equal(sends, before)
    }
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('failed cleanup recovers after short lease, and concurrent callbacks send one token', async () => {
  globalThis.fetch = (async () => {
    sends++
    if (failure) throw new Error('Network unavailable')
    return new Response('', { status: 200 })
  }) as typeof fetch
  try {
    row = null
    failure = 'network'
    cleanupFails = true
    assert.equal(
      (await notifyAdminOfPendingUser(pending)).reason,
      'email_send_failed'
    )
    failure = null
    assert.equal(
      (await notifyAdminOfPendingUser(pending)).reason,
      'notification_in_progress'
    )
    assert.ok(row)
    ;(row as Row).created_at = new Date(Date.now() - 121_000).toISOString()
    cleanupFails = false
    assert.equal((await notifyAdminOfPendingUser(pending)).sent, true)
    row = null
    const before = sends
    const results = await Promise.all([
      notifyAdminOfPendingUser(pending),
      notifyAdminOfPendingUser(pending)
    ])
    assert.equal(results.filter((result) => result.sent).length, 1)
    assert.equal(sends - before, 1)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('approval requires admin and same origin, hashes valid input and preserves RPC responses/retry', async () => {
  const token = 'a'.repeat(43)
  const context = { params: Promise.resolve({ token }) }
  const request = (headers: Record<string, string> = {}) =>
    new Request(`https://family.example/api/admin/approve/${token}`, {
      method: 'POST',
      headers
    })
  isAdmin = false
  user = null
  assert.equal((await approval.GET(request(), context)).status, 307)
  assert.equal((await approval.POST(request(), context)).status, 403)
  isAdmin = true
  user = { id: 'admin' }
  assert.equal(
    (
      await approval.POST(
        request({ origin: 'https://attacker.example' }),
        context
      )
    ).status,
    403
  )
  assert.equal(
    (
      await approval.POST(
        request({ referer: 'https://family.example.attacker/path' }),
        context
      )
    ).status,
    403
  )
  assert.equal(rpcCalls, 0)
  assert.equal(
    (
      await approval.POST(request(), {
        params: Promise.resolve({ token: 'invalid' })
      })
    ).status,
    404
  )
  for (const [status, expected] of [
    ['invalid', 404],
    ['not_found', 404],
    ['processed', 200],
    ['approved', 200]
  ] as const) {
    rpcStatus = status
    const response = await approval.POST(request(), context)
    assert.equal(response.status, expected)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    if (status === 'approved')
      assert.match(await response.text(), /&lt;pending&gt;/)
  }
  assert.match(observedHash, /^[a-f0-9]{64}$/)
  rpcError = true
  assert.equal((await approval.POST(request(), context)).status, 500)
  rpcError = false
  assert.equal((await approval.POST(request(), context)).status, 200)
})
