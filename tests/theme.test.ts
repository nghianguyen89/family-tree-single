import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import {
  resolveTheme,
  THEME_STORAGE_KEY,
  themeInitScript
} from '../utils/theme'

test('theme preference overrides the system; invalid preferences use the system', () => {
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('dark', false), 'dark')
  assert.equal(resolveTheme(null, true), 'dark')
  assert.equal(resolveTheme('invalid', false), 'light')
})

test('the head script applies the theme before hydration, including blocked storage', () => {
  for (const scenario of [
    { saved: 'dark', system: false, blocked: false, expected: 'dark' },
    { saved: 'light', system: true, blocked: false, expected: 'light' },
    { saved: null, system: true, blocked: false, expected: 'dark' },
    { saved: 'invalid', system: false, blocked: false, expected: 'light' },
    { saved: null, system: true, blocked: true, expected: 'dark' }
  ]) {
    const dataset: { theme?: string } = {}
    runInNewContext(themeInitScript, {
      document: { documentElement: { dataset } },
      window: { matchMedia: () => ({ matches: scenario.system }) },
      localStorage: {
        getItem(key: string) {
          assert.equal(key, THEME_STORAGE_KEY)
          if (scenario.blocked) throw new Error('Storage unavailable')
          return scenario.saved
        }
      }
    })
    assert.equal(dataset.theme, scenario.expected)
  }
})
