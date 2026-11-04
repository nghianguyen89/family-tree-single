export const PRODUCT_REPOSITORY = 'nghianguyen89/family-tree-single'
export const PRODUCT_UPDATE_GUIDE = `https://github.com/${PRODUCT_REPOSITORY}#readme`

export interface ProductRelease {
  version: string
  notes: string
  url?: string
  mandatory?: {
    reason: string
    affected: Array<{ minVersion: string; maxVersionExclusive: string }>
  }
}

export interface ReleaseManifest {
  manifestVersion: 1
  repository: typeof PRODUCT_REPOSITORY
  releases: ProductRelease[]
}

export type SourceVersionState =
  'current' | 'outdated' | 'mandatory' | 'unknown'
export interface SourceVersionStatus {
  state: SourceVersionState
  currentVersion: string | null
  latestVersion: string | null
  readmeUrl: string
  releases?: ProductRelease[]
  mandatoryReleases?: ProductRelease[]
  error?: string
}

function parseVersion(value: string) {
  const match = value.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
  )
  if (!match) throw new Error('Invalid release version.')
  const numbers = match.slice(1, 4).map(Number)
  const prerelease = match[4]?.split('.') ?? []
  if (
    numbers.some((n) => !Number.isSafeInteger(n)) ||
    prerelease.some((n) => /^0\d+$/.test(n))
  ) {
    throw new Error('Invalid release version.')
  }
  return { numbers, prerelease }
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let i = 0; i < 3; i++) {
    if (a.numbers[i] !== b.numbers[i])
      return a.numbers[i] > b.numbers[i] ? 1 : -1
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length ? -1 : b.prerelease.length ? 1 : 0
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i]
    const y = b.prerelease[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1
    if (xn !== yn) return xn ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}

export function parseReleaseManifest(value: unknown): ReleaseManifest {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid release manifest.')
  const manifest = value as ReleaseManifest
  if (
    manifest.manifestVersion !== 1 ||
    manifest.repository !== PRODUCT_REPOSITORY ||
    !Array.isArray(manifest.releases) ||
    manifest.releases.length > 100
  ) {
    throw new Error('Unknown release manifest format or repository.')
  }
  const versions = new Set<string>()
  for (const release of manifest.releases) {
    if (
      !release ||
      typeof release.version !== 'string' ||
      typeof release.notes !== 'string' ||
      !release.notes.trim() ||
      release.notes.length > 8000
    )
      throw new Error('Invalid release entry.')
    parseVersion(release.version)
    if (versions.has(release.version))
      throw new Error('Duplicate release version.')
    versions.add(release.version)
    if (
      release.url !== undefined &&
      (typeof release.url !== 'string' ||
        !release.url.startsWith(
          `https://github.com/${PRODUCT_REPOSITORY}/releases/`
        ))
    )
      throw new Error('Invalid release URL.')
    if (release.mandatory !== undefined) {
      const { reason, affected } = release.mandatory
      if (
        typeof reason !== 'string' ||
        !reason.trim() ||
        reason.length > 2000 ||
        !Array.isArray(affected) ||
        !affected.length ||
        affected.length > 100
      )
        throw new Error('Invalid mandatory release policy.')
      for (const range of affected) {
        if (
          !range ||
          typeof range.minVersion !== 'string' ||
          typeof range.maxVersionExclusive !== 'string' ||
          compareVersions(range.minVersion, range.maxVersionExclusive) >= 0 ||
          compareVersions(range.maxVersionExclusive, release.version) > 0
        )
          throw new Error('Invalid affected version range.')
      }
    }
  }
  // Return only the public contract; ignore arbitrary fields supplied by the feed.
  return {
    manifestVersion: 1,
    repository: PRODUCT_REPOSITORY,
    releases: manifest.releases.map(({ version, notes, url, mandatory }) => ({
      version,
      notes,
      ...(url ? { url } : {}),
      ...(mandatory
        ? {
            mandatory: {
              reason: mandatory.reason,
              affected: mandatory.affected.map(
                ({ minVersion, maxVersionExclusive }) => ({
                  minVersion,
                  maxVersionExclusive
                })
              )
            }
          }
        : {})
    }))
  }
}

export function evaluateReleases(
  currentVersion: string,
  manifest: ReleaseManifest
): SourceVersionStatus {
  parseVersion(currentVersion)
  const sorted = [...manifest.releases].sort((a, b) =>
    compareVersions(b.version, a.version)
  )
  const releases = sorted.filter(
    (r) => compareVersions(r.version, currentVersion) > 0
  )
  const mandatoryReleases = releases.filter((r) =>
    r.mandatory?.affected.some(
      (range) =>
        compareVersions(currentVersion, range.minVersion) >= 0 &&
        compareVersions(currentVersion, range.maxVersionExclusive) < 0
    )
  )
  return {
    state: mandatoryReleases.length
      ? 'mandatory'
      : releases.length
        ? 'outdated'
        : 'current',
    currentVersion,
    latestVersion: sorted[0]?.version ?? currentVersion,
    readmeUrl: PRODUCT_UPDATE_GUIDE,
    releases,
    mandatoryReleases
  }
}

export function isSchemaCompatible(
  appliedIds: string[],
  selectedIds: readonly string[]
): boolean {
  const selected = new Set(selectedIds)
  return appliedIds.every((id) => selected.has(id))
}
