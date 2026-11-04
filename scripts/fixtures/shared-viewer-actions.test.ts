import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { beforeEach, test } from 'node:test'

import { NextRequest } from 'next/server'

const { mock } = createRequire(import.meta.url)('bun:test')
type Row = Record<string, unknown>
const adminProfile = { role: 'admin', is_active: true, is_shared_viewer: false }
const viewerProfile = {
  id: 'viewer',
  role: 'member',
  is_active: true,
  is_shared_viewer: true,
  person_id: null
}
let actor: Row | null
let viewer: Row | null
let existing: Row | null
let failure: string
let calls: Array<[string, unknown]>

function query(service = false) {
  let updating = false
  let values: Row = {}
  const filters: Array<[string, unknown]> = []
  const result = () => {
    if (updating) {
      calls.push(['profileUpdate', { values, filters }])
      const failed =
        failure === 'profile' ||
        (failure === 'enable' && values.is_active === true)
      if (!failed && viewer) Object.assign(viewer, values)
      return {
        data: { id: 'viewer' },
        error: failed ? new Error('profile') : null
      }
    }
    return { data: viewer, error: null }
  }
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => {
      filters.push([key, value])
      return builder
    },
    update: (next: Row) => {
      assert.equal(service, true)
      updating = true
      values = next
      return builder
    },
    maybeSingle: async () => ({
      data: existing,
      error: failure === 'migration' ? new Error('missing column') : null
    }),
    single: async () => result(),
    limit: async () => ({ data: [], error: null })
  }
  return builder
}

const client = {
  from: (table: string) => {
    assert.equal(table, 'profiles')
    return query()
  },
  rpc: async (name: string, args: unknown) => {
    calls.push([name, args])
    return { error: failure === 'sessions' ? new Error('sessions') : null }
  },
  auth: {
    signInWithPassword: async (credentials: unknown) => {
      calls.push(['login', credentials])
      return {
        data: { user: failure === 'noUser' ? null : { id: 'viewer' } },
        error: failure === 'login' ? new Error('wrong PIN') : null
      }
    },
    signOut: async (options: unknown) => {
      calls.push(['signOut', options])
      return { error: null }
    }
  }
}

mock.module('next/cache', () => ({
  revalidatePath: (path: string) => calls.push(['revalidate', path])
}))
mock.module('../../utils/supabase/queries', () => ({
  getSupabase: async () => client,
  getProfile: async () => actor
}))
mock.module('../../utils/supabase/admin', () => ({
  getAdminSupabase: () => ({
    from: () => query(true),
    auth: {
      admin: {
        createUser: async (options: unknown) => {
          calls.push(['create', options])
          return {
            data: { user: failure === 'noUser' ? null : { id: 'viewer' } },
            error: failure === 'create' ? new Error('create') : null
          }
        },
        updateUserById: async (id: string, options: unknown) => {
          calls.push(['password', { id, options }])
          return {
            error: failure === 'password' ? new Error('password') : null
          }
        }
      }
    }
  })
}))
mock.module('../../utils/deployment', () => ({ deploymentError: () => null }))
mock.module('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (
          cookies: Array<{
            name: string
            value: string
            options: { httpOnly: boolean; path: string }
          }>
        ) => void
      }
    }
  ) => ({
    from: () => query(),
    auth: {
      getUser: async () => {
        options.cookies.setAll([
          {
            name: 'fixture-session',
            value: 'refreshed',
            options: { httpOnly: true, path: '/' }
          }
        ])
        return { data: { user: { id: 'viewer' } } }
      }
    }
  })
}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture.supabase.test'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY = 'fixture-key'
const { signInSharedViewer, saveSharedViewer } =
  await import('../../app/actions/shared-viewer')
const { updateSession } = await import('../../utils/supabase/middleware')

beforeEach(() => {
  actor = { ...adminProfile }
  viewer = { ...viewerProfile }
  existing = { id: 'viewer', is_active: true }
  failure = ''
  calls = []
})

function form(pin = '', enabled = true) {
  const data = new FormData()
  data.set('pin', pin)
  if (enabled) data.set('enabled', 'on')
  return data
}

test('PIN login only accepts eight digits and maps to the reserved email', async () => {
  for (const pin of [
    '',
    '1234567',
    '123456789',
    'abcdefgh',
    '1234 678',
    '１２３４５６７８'
  ]) {
    assert.deepEqual(await signInSharedViewer(pin), { error: 'invalidPin' })
  }
  assert.deepEqual(calls, [])
  assert.deepEqual(await signInSharedViewer('01234567'), { success: true })
  assert.deepEqual(calls, [
    [
      'login',
      { email: 'shared-viewer@family-tree.invalid', password: '01234567' }
    ]
  ])
})

test('wrong PIN and missing Auth user fail without reporting success', async () => {
  for (const mode of ['login', 'noUser']) {
    failure = mode
    assert.deepEqual(await signInSharedViewer('12345678'), {
      error: 'loginFailed'
    })
  }
})

test('login signs out locally for missing, inactive, unflagged, elevated or linked profiles', async () => {
  for (const profile of [
    null,
    { ...viewerProfile, is_active: false },
    { ...viewerProfile, is_shared_viewer: false },
    { ...viewerProfile, role: 'admin' },
    { ...viewerProfile, person_id: 'person' }
  ]) {
    viewer = profile
    calls = []
    assert.deepEqual(await signInSharedViewer('12345678'), {
      error: 'loginFailed'
    })
    assert.deepEqual(calls.at(-1), ['signOut', { scope: 'local' }])
  }
})

test('create, reset and lock require an active ordinary admin', async () => {
  for (const profile of [
    null,
    { ...adminProfile, role: 'member' },
    { ...adminProfile, is_active: false },
    { ...adminProfile, is_shared_viewer: true }
  ]) {
    actor = profile
    for (const [pin, enabled] of [
      ['12345678', true],
      ['', false]
    ] as const) {
      assert.deepEqual(await saveSharedViewer(form(pin, enabled)), {
        error: 'permission'
      })
    }
  }
  assert.deepEqual(calls, [])
})

test('preflight and invalid PIN prevent Auth creation', async () => {
  existing = null
  assert.deepEqual(await saveSharedViewer(form()), { error: 'invalidPin' })
  assert.deepEqual(await saveSharedViewer(form('bad')), { error: 'invalidPin' })
  failure = 'migration'
  assert.deepEqual(await saveSharedViewer(form('12345678')), {
    error: 'migration'
  })
  assert.deepEqual(calls, [])
})

test('creation confirms the fixed email and updates only the flagged profile by ID', async () => {
  existing = null
  assert.deepEqual(await saveSharedViewer(form('12345678')), { success: true })
  assert.deepEqual(calls, [
    [
      'create',
      {
        email: 'shared-viewer@family-tree.invalid',
        password: '12345678',
        email_confirm: true
      }
    ],
    [
      'profileUpdate',
      {
        values: { is_active: true },
        filters: [
          ['id', 'viewer'],
          ['is_shared_viewer', true]
        ]
      }
    ],
    ['revalidate', '/dashboard/users']
  ])
})

test('reset and lock revoke existing sessions; unchanged enable does not', async () => {
  for (const [pin, enabled] of [
    ['12345678', true],
    ['', false],
    ['', true]
  ] as const) {
    calls = []
    assert.deepEqual(await saveSharedViewer(form(pin, enabled)), {
      success: true
    })
    assert.equal(
      calls.some(([name]) => name === 'password'),
      Boolean(pin)
    )
    assert.equal(
      calls.some(([name]) => name === 'revoke_shared_viewer_sessions'),
      Boolean(pin || !enabled)
    )
    if (pin || !enabled) {
      assert.deepEqual(calls[0], [
        'profileUpdate',
        {
          values: { is_active: false },
          filters: [
            ['id', 'viewer'],
            ['is_shared_viewer', true]
          ]
        }
      ])
      const revocation = calls.findIndex(
        ([name]) => name === 'revoke_shared_viewer_sessions'
      )
      assert.deepEqual(calls[revocation], [
        'revoke_shared_viewer_sessions',
        { p_user_id: 'viewer' }
      ])
      assert.ok(
        revocation < calls.findLastIndex(([name]) => name === 'profileUpdate')
      )
    }
    assert.deepEqual(
      calls.filter(([name]) => name === 'profileUpdate').at(-1),
      [
        'profileUpdate',
        {
          values: { is_active: enabled },
          filters: [
            ['id', 'viewer'],
            ['is_shared_viewer', true]
          ]
        }
      ]
    )
  }
})

test('Auth creation/reset, profile update and revocation failures never claim success', async () => {
  for (const mode of [
    'create',
    'noUser',
    'password',
    'profile',
    'sessions',
    'enable'
  ]) {
    calls = []
    existing = mode === 'create' || mode === 'noUser' ? null : { id: 'viewer' }
    failure = mode
    assert.deepEqual(await saveSharedViewer(form('12345678')), {
      error: mode === 'sessions' ? 'sessionsFailed' : 'setupFailed'
    })
    if (mode === 'create' || mode === 'noUser')
      assert.equal(
        calls.some(
          ([name]) => name === 'profileUpdate' || name === 'revalidate'
        ),
        false
      )
    if (mode === 'password' || mode === 'sessions' || mode === 'enable')
      assert.equal(viewer?.is_active, false)
    if (mode === 'profile')
      assert.equal(
        calls.some(
          ([name]) =>
            name === 'password' || name === 'revoke_shared_viewer_sessions'
        ),
        false
      )
  }
})

test('middleware enforces shared route allowlist and preserves refreshed cookies on redirects', async () => {
  for (const path of [
    '/dashboard/kinship',
    '/dashboard/members/new',
    '/dashboard/members/12345678-1234-1234-1234-123456789abc/edit',
    '/dashboard/users',
    '/dashboard/admin',
    '/dashboard/settings'
  ]) {
    const request = new NextRequest(
      `https://family.example${path}?secret=query`
    )
    const response = await updateSession(request)
    assert.equal(response.status, 307)
    assert.equal(
      response.headers.get('location'),
      'https://family.example/dashboard'
    )
    assert.equal(response.cookies.get('fixture-session')?.value, 'refreshed')
    assert.equal(response.cookies.get('fixture-session')?.httpOnly, true)
    assert.equal(request.cookies.get('fixture-session')?.value, 'refreshed')
  }
})

test('middleware permits allowed viewer pages and leaves ordinary member routes unchanged', async () => {
  for (const path of [
    '/dashboard',
    '/dashboard/members',
    '/dashboard/events',
    '/dashboard/gallery',
    '/dashboard/stats',
    '/dashboard/members/12345678-1234-1234-1234-123456789abc'
  ]) {
    const response = await updateSession(
      new NextRequest(`https://family.example${path}`)
    )
    assert.equal(response.headers.get('location'), null)
    assert.equal(response.cookies.get('fixture-session')?.value, 'refreshed')
  }
  viewer = { ...viewerProfile, is_shared_viewer: false }
  for (const path of [
    '/dashboard/kinship',
    '/dashboard/members/new',
    '/dashboard/users'
  ]) {
    assert.equal(
      (
        await updateSession(new NextRequest(`https://family.example${path}`))
      ).headers.get('location'),
      null
    )
  }
})
