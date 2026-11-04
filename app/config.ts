import { getPublicDeploymentConfig } from '@/utils/deployment'

let family: ReturnType<typeof getPublicDeploymentConfig> | null = null
let configError: string | null = null
try {
  family = getPublicDeploymentConfig()
} catch (error) {
  configError = (error as Error).message
}
const config = {
  siteName: family?.siteName || 'Gia Phả',
  familyId: family?.id || '',
  isDemo: family?.isDemo || false,
  appUrl: family?.appUrl || '',
  logo: family?.logo ? '/family-assets/logo' : '',
  configError
}

export default config
