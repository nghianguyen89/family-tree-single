import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  activeNavigationHref,
  getDashboardNavigation
} from '../utils/dashboard-navigation'
import { isSharedViewerPath, validSharedPin } from '../utils/shared-viewer'

test('shared viewer sees exactly five family menus and only read routes, with an eight-digit PIN', () => {
  const navigation = getDashboardNavigation({
    role: 'member',
    is_active: true,
    is_shared_viewer: true
  })
  assert.deepEqual(
    navigation.map((group) => group.key),
    ['family']
  )
  assert.deepEqual(
    navigation.flatMap((group) => group.items.map((item) => item.href)),
    [
      '/dashboard',
      '/dashboard/members',
      '/dashboard/events',
      '/dashboard/gallery',
      '/dashboard/stats'
    ]
  )
  for (const href of navigation.flatMap((group) =>
    group.items.map((item) => item.href)
  ))
    assert.equal(isSharedViewerPath(href), true)
  assert.equal(
    isSharedViewerPath(
      '/dashboard/members/11111111-1111-4111-8111-111111111111'
    ),
    true
  )
  for (const href of [
    '/dashboard/members/new',
    '/dashboard/members/11111111-1111-4111-8111-111111111111/edit',
    '/dashboard/kinship',
    '/dashboard/branches/example',
    '/dashboard/users',
    '/dashboard/data',
    '/dashboard/stats/other'
  ])
    assert.equal(isSharedViewerPath(href), false)
  assert.deepEqual(
    getDashboardNavigation({
      role: 'member',
      is_active: false,
      is_shared_viewer: true
    }),
    []
  )
  assert.equal(validSharedPin('01234567'), true)
  for (const pin of [
    null,
    12345678,
    '',
    '1234567',
    '123456789',
    'abcd1234',
    '1234567\n'
  ])
    assert.equal(validSharedPin(pin), false)
})

const links = (role: 'admin' | 'editor' | 'member', is_active = true) =>
  getDashboardNavigation({ role, is_active }).flatMap((group) => group.items)

test('dashboard navigation follows active member, editor and admin route permissions', () => {
  const member = links('member').map((item) => item.href)
  for (const href of [
    '/dashboard',
    '/dashboard/members',
    '/dashboard/kinship',
    '/dashboard/events',
    '/dashboard/gallery',
    '/dashboard/stats',
    '/',
    '/news',
    '/about'
  ])
    assert.ok(member.includes(href))
  assert.ok(
    member.every(
      (href) =>
        ![
          '/dashboard/intake',
          '/dashboard/content',
          '/dashboard/users',
          '/dashboard/data'
        ].includes(href)
    )
  )
  const editor = links('editor').map((item) => item.href)
  for (const href of [
    '/dashboard/members/new',
    '/dashboard/intake',
    '/dashboard/content',
    '/dashboard/content/settings'
  ])
    assert.ok(editor.includes(href))
  for (const href of [
    '/dashboard/users',
    '/dashboard/lineage',
    '/dashboard/data',
    '/dashboard/upgrade'
  ]) {
    assert.ok(!editor.includes(href))
    assert.ok(links('admin').some((item) => item.href === href))
  }
  for (const role of ['admin', 'editor', 'member'] as const)
    assert.deepEqual(
      links(role, false).map((item) => item.href),
      ['/', '/news', '/about']
    )
  assert.deepEqual(
    getDashboardNavigation(null).flatMap((group) =>
      group.items.map((item) => item.href)
    ),
    ['/', '/news', '/about']
  )
})

test('navigation selects the most specific route without highlighting unrelated prefixes', () => {
  const items = links('admin')
  assert.equal(
    activeNavigationHref('/dashboard/content/settings', items),
    '/dashboard/content/settings'
  )
  assert.equal(
    activeNavigationHref('/dashboard/content/new', items),
    '/dashboard/content'
  )
  assert.equal(
    activeNavigationHref('/dashboard/members/new', items),
    '/dashboard/members/new'
  )
  assert.equal(
    activeNavigationHref('/dashboard/members/example/edit', items),
    '/dashboard/members'
  )
  assert.equal(activeNavigationHref('/dashboard', items), '/dashboard')
  assert.equal(
    activeNavigationHref('/dashboard/gallery', items),
    '/dashboard/gallery'
  )
  assert.equal(activeNavigationHref('/news/article', items), '/news')
  assert.equal(activeNavigationHref('/dashboard/memberships', items), undefined)
})
