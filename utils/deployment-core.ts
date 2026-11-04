import {
  canonicalAppUrl,
  parseFamilyConfig,
  validateDatabaseBinding,
  validateKeyProject,
  validatePublicBinding,
  type PublicDeployment
} from './family-config'

const configurationMessage =
  'Cấu hình gia tộc hoặc liên kết môi trường không hợp lệ. Kiểm tra cấu hình website, APP_URL và project Supabase của bản triển khai.'

// Branding must render identically on the server and browser, even when a
// server-only credential is invalid. Data clients additionally validate it below.
export function getPublicDeploymentConfig(): PublicDeployment {
  try {
    const raw = JSON.parse(process.env.NEXT_PUBLIC_FAMILY_CONFIG || 'null')
    const config = parseFamilyConfig(raw, raw?.id || '')
    const appUrl = canonicalAppUrl(raw.appUrl, config.domain)
    validatePublicBinding(
      config,
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || ''
    )
    return {
      ...config,
      appUrl,
      logo: typeof raw.logo === 'string' ? raw.logo : ''
    }
  } catch {
    throw new Error(configurationMessage)
  }
}

export function getDeploymentConfig(): PublicDeployment {
  try {
    const config = getPublicDeploymentConfig()
    if (typeof window === 'undefined') {
      if ((process.env.FAMILY_ID || 'single') !== config.id)
        throw new Error('Family mismatch')
      if (
        canonicalAppUrl(process.env.APP_URL || '', config.domain) !==
        config.appUrl
      )
        throw new Error('URL mismatch')
      if (process.env.SUPABASE_SERVICE_ROLE_KEY)
        validateKeyProject(
          process.env.SUPABASE_SERVICE_ROLE_KEY,
          config.supabaseProjectRef,
          'service_role'
        )
      if (process.env.SUPABASE_DB_URL)
        validateDatabaseBinding(
          process.env.SUPABASE_DB_URL,
          config.supabaseProjectRef
        )
    }
    return config
  } catch {
    throw new Error(configurationMessage)
  }
}
export function assertDatabaseTarget(databaseUrl: string): void {
  validateDatabaseBinding(databaseUrl, getDeploymentConfig().supabaseProjectRef)
}
export function deploymentError(): string | null {
  try {
    getDeploymentConfig()
    return null
  } catch (error) {
    return (error as Error).message
  }
}
