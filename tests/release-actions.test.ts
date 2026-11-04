import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

// Bun module mocks are process-global. Keep this fixture isolated from the suite.
test('release-actions isolated action fixture', () => {
  const output = execFileSync(
    process.execPath,
    ['test', './scripts/fixtures/release-actions.test.ts'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30000,
      windowsHide: true
    }
  )
  if (output.trim()) console.log(output.trim())
  console.log('release-actions: 4 isolated inner tests PASS')
})
