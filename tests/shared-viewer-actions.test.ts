import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

test('isolated shared viewer authentication, administration and middleware', () => {
  execFileSync(
    process.execPath,
    ['test', './scripts/fixtures/shared-viewer-actions.test.ts'],
    { cwd: process.cwd(), stdio: 'pipe', timeout: 30000, windowsHide: true }
  )
})
