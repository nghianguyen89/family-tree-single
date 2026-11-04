import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

// Bun module mocks are process-global. Keep this fixture isolated from the suite.
test('auth-callback isolated action fixture', () => {
  const output = execFileSync(
    process.execPath,
    ['test', './scripts/fixtures/auth-callback.test.ts'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30000,
      windowsHide: true
    }
  )
  if (output.trim()) console.log(output.trim())
  console.log('auth-callback: 3 isolated inner tests PASS')
})
