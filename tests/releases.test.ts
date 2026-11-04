import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  compareVersions,
  evaluateReleases,
  isSchemaCompatible,
  parseReleaseManifest
} from '../utils/releases'
import fixture from './fixtures/release-manifest.json'

const manifest = parseReleaseManifest(fixture)

test('a later ordinary release retains mandatory warnings for affected versions', () => {
  const status = evaluateReleases('2.3.0', manifest)
  assert.equal(status.state, 'mandatory')
  assert.equal(status.latestVersion, '2.4.0')
  assert.deepEqual(
    status.mandatoryReleases?.map((r) => r.version),
    ['2.3.1']
  )
  assert.equal(evaluateReleases('2.3.1', manifest).state, 'outdated')
  assert.equal(evaluateReleases('1.9.9', manifest).state, 'outdated')
  assert.equal(evaluateReleases('2.4.0', manifest).state, 'current')
})

test('evaluating upgraded B preserves A release policy and the shared manifest', () => {
  const before = structuredClone(manifest)
  const a = evaluateReleases('2.3.0', manifest)
  const aBefore = structuredClone(a)
  const b = evaluateReleases('2.4.0', manifest)
  assert.equal(b.state, 'current')
  assert.deepEqual(a, aBefore)
  assert.equal(a.state, 'mandatory')
  assert.deepEqual(manifest, before)
})

test('release contracts reject wrong product, malformed policies and versions', () => {
  for (const value of [
    { ...fixture, repository: 'homielab/giapha-os' },
    { ...fixture, manifestVersion: 2 },
    { ...fixture, releases: [{ version: 'latest', notes: 'bad' }] },
    {
      ...fixture,
      releases: [
        {
          version: '2.4.0',
          notes: 'bad',
          mandatory: { reason: 'why', affected: [] }
        }
      ]
    },
    {
      ...fixture,
      releases: [
        {
          version: '2.4.0',
          notes: 'bad',
          mandatory: {
            reason: 'why',
            affected: [{ minVersion: '2.4.0', maxVersionExclusive: '3.0.0' }]
          }
        }
      ]
    },
    { ...fixture, releases: [...fixture.releases, fixture.releases[0]] },
    {
      ...fixture,
      releases: [{ version: '2.4.0', notes: 'bad', url: 'javascript:alert(1)' }]
    }
  ])
    assert.throws(() => parseReleaseManifest(value))
  assert.throws(() => evaluateReleases('bad', manifest))
})

test('version ordering respects prerelease, numeric identifiers and build metadata', () => {
  assert.equal(compareVersions('2.3.0', '2.3.0-rc.1'), 1)
  assert.equal(compareVersions('2.3.0-rc.10', '2.3.0-rc.2'), 1)
  assert.equal(compareVersions('2.3.0+build.a', '2.3.0+build.b'), 0)
  assert.throws(() => compareVersions('2.3.0-01', '2.3.0'))
})

test('selected schema can apply known pending migrations without latest release checks', () => {
  assert.equal(isSchemaCompatible(['schema'], ['schema', 'one']), true)
  assert.equal(
    isSchemaCompatible(['schema', 'future'], ['schema', 'one']),
    false
  )
})
