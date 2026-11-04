import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { mock } = require('bun:test')
let valid = true
let clients = 0
let exchangeError = false
let pendingUser = false
let notifications = 0
const exchanges: string[] = []
mock.module('../../utils/deployment', () => ({
  getDeploymentConfig: () => {
    if (!valid) throw new Error('Invalid binding')
    return { appUrl: 'https://family-a.example' }
  }
}))
mock.module('next/headers', () => ({ cookies: async () => ({}) }))
mock.module('../../utils/supabase/server', () => ({
  createClient: () => {
    clients++
    return {
      auth: {
        exchangeCodeForSession: async (code: string) => {
          exchanges.push(code)
          return { error: exchangeError ? new Error('Bad code') : null }
        },
        getUser: async () => ({
          data: {
            user: pendingUser
              ? { id: 'pending', email: 'pending@example.test' }
              : null
          }
        })
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { role: 'member', is_active: false }
            })
          })
        })
      })
    }
  }
}))
mock.module('../../utils/approval-notification', () => ({
  notifyAdminOfPendingUser: async () => {
    notifications++
    throw new Error('Notification failed')
  }
}))
const callback = await import('../../app/auth/callback/route')

test('callback redirects to configured origin regardless of request host', async () => {
  for (const [query, path] of [
    ['', '/dashboard'],
    ['?error=access_denied', '/login?error=auth_callback_failed'],
    ['?code=verified-code', '/dashboard']
  ]) {
    const response = await callback.GET(
      new Request(`https://attacker.example/auth/callback${query}`)
    )
    assert.equal(
      response.headers.get('location'),
      `https://family-a.example${path}`
    )
  }
  assert.deepEqual(exchanges, ['verified-code'])
  exchangeError = true
  const rejected = await callback.GET(
    new Request('https://attacker.example/auth/callback?code=bad')
  )
  assert.equal(
    rejected.headers.get('location'),
    'https://family-a.example/login?error=auth_callback_failed'
  )
})

test('invalid deployment blocks callback before Supabase client creation', async () => {
  valid = false
  const before = clients
  const response = await callback.GET(
    new Request('https://attacker.example/auth/callback?code=any')
  )
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('location'), null)
  assert.equal(clients, before)
})

test('notification failure cannot interrupt an exchanged auth session', async () => {
  valid = true
  exchangeError = false
  pendingUser = true
  const response = await callback.GET(
    new Request('https://family-a.example/auth/callback?code=confirmed')
  )
  assert.equal(response.status, 307)
  assert.equal(
    response.headers.get('location'),
    'https://family-a.example/dashboard'
  )
  assert.equal(notifications, 1)
  assert.equal(exchanges.at(-1), 'confirmed')
})
