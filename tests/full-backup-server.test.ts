import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

test('full-backup server coordinator (isolated module mocks)', () => {
  const output = execFileSync(
    process.execPath,
    ['test', './scripts/fixtures/full-backup-server.test.ts'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30000,
      windowsHide: true
    }
  )
  if (output.trim()) console.log(output.trim())
  console.log('full-backup server: 8 isolated inner tests PASS')
})
