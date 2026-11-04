import { getDeploymentConfig } from '@/utils/deployment'

export function GET() {
  try {
    const family = getDeploymentConfig()
    return new Response(Buffer.from(family.logo, 'base64'), {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; sandbox"
      }
    })
  } catch {
    return new Response('Invalid family configuration', { status: 503 })
  }
}
