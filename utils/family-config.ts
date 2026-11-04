export interface FamilyConfig {
  configVersion: 1
  id: string
  siteName: string
  domain: string
  isDemo: boolean
  supabaseProjectRef: string
}
export interface PublicDeployment extends FamilyConfig {
  appUrl: string
  logo: string
}
export function parseFamilyConfig(
  value: unknown,
  familyId: string
): FamilyConfig {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid family config')
  const c = value as Record<string, unknown>
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(familyId) ||
    c.id !== familyId ||
    c.configVersion !== 1 ||
    typeof c.siteName !== 'string' ||
    !c.siteName.trim() ||
    c.siteName.length > 100 ||
    typeof c.domain !== 'string' ||
    !/^[a-z0-9.-]+$/.test(c.domain) ||
    typeof c.isDemo !== 'boolean' ||
    typeof c.supabaseProjectRef !== 'string' ||
    !/^[a-z0-9]{20}$/.test(c.supabaseProjectRef)
  )
    throw new Error('Invalid family config')
  // Projection prevents accidental unknown fields/secrets from entering public bundles.
  return {
    configVersion: 1,
    id: familyId,
    siteName: c.siteName.trim(),
    domain: c.domain,
    isDemo: c.isDemo,
    supabaseProjectRef: c.supabaseProjectRef
  }
}
export function canonicalAppUrl(value: string, domain: string): string {
  const url = new URL(value)
  const local = ['localhost', '127.0.0.1'].includes(url.hostname)
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (!local && (url.protocol !== 'https:' || url.hostname !== domain)) ||
    (local && !['http:', 'https:'].includes(url.protocol))
  )
    throw new Error('APP_URL does not match family domain')
  return url.origin
}
export function validatePublicBinding(
  config: FamilyConfig,
  url: string,
  key: string
) {
  if (url !== `https://${config.supabaseProjectRef}.supabase.co` || !key)
    throw new Error('Supabase project binding mismatch')
  validateKeyProject(key, config.supabaseProjectRef, 'anon')
}
export function validateKeyProject(
  key: string,
  ref: string,
  role: 'anon' | 'service_role'
) {
  if (
    key.startsWith(role === 'anon' ? 'sb_publishable_' : 'sb_secret_') &&
    key.length > 25
  )
    return
  try {
    const payload = JSON.parse(
      atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    )
    if (payload.ref === ref && payload.role === role) return
  } catch {
    /* Never expose key/decoded contents. */
  }
  throw new Error('Supabase key binding mismatch')
}
export function validateDatabaseBinding(databaseUrl: string, ref: string) {
  const url = new URL(databaseUrl)
  if (
    [...url.searchParams.keys()].some((key) => key !== 'sslmode') ||
    url.searchParams.getAll('sslmode').length > 1 ||
    (url.searchParams.has('sslmode') &&
      !['require', 'verify-full'].includes(url.searchParams.get('sslmode')!))
  )
    throw new Error('Invalid database options')
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.pathname !== '/postgres'
  )
    throw new Error('Invalid database binding')
  const direct =
    url.hostname === `db.${ref}.supabase.co` &&
    ['postgres', `postgres.${ref}`].includes(decodeURIComponent(url.username))
  const pooled =
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    decodeURIComponent(url.username) === `postgres.${ref}`
  if (!direct && !pooled) throw new Error('Database project binding mismatch')
}
