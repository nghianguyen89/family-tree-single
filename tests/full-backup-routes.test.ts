import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

// Bun module mocks are process-global. Keep this fixture isolated from the suite.
test('full-backup routes isolated fixture', () => {
  const output = execFileSync(
    process.execPath,
    ['test', './scripts/fixtures/full-backup-routes.test.ts'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30000,
      windowsHide: true
    }
  )
  if (output.trim()) console.log(output.trim())
})
