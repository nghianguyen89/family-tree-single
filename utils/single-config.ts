import {
  canonicalAppUrl,
  parseFamilyConfig,
  validatePublicBinding,
  type PublicDeployment
} from './family-config'

// The single edition requires no filesystem configuration. Only public metadata
// is returned; server credentials must never enter the build's env object.
export function singleDeploymentConfig(
  env: Record<string, string | undefined>
): PublicDeployment {
  if (env.FAMILY_ID) throw new Error('A family configuration was selected')
  const appUrl = new URL(env.APP_URL || '')
  const match = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(
    env.NEXT_PUBLIC_SUPABASE_URL || ''
  )
  if (!match) throw new Error('Invalid Supabase URL')
  const family = parseFamilyConfig(
    {
      configVersion: 1,
      id: 'single',
      siteName: env.SITE_NAME || 'Gia Phả',
      domain: appUrl.hostname,
      supabaseProjectRef: match[1],
      isDemo: false
    },
    'single'
  )
  validatePublicBinding(
    family,
    env.NEXT_PUBLIC_SUPABASE_URL || '',
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || ''
  )
  return {
    ...family,
    appUrl: canonicalAppUrl(env.APP_URL || '', family.domain),
    logo: ''
  }
}
