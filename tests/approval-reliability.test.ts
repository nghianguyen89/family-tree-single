import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

test('isolated approval route and notification reliability fixtures', () => {
  execFileSync(
    process.execPath,
    ['test', './scripts/fixtures/approval-reliability.test.ts'],
    {
      cwd: process.cwd(),
      stdio: 'pipe',
      timeout: 30000,
      windowsHide: true
    }
  )
})
