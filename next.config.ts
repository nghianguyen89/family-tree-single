import type { NextConfig } from 'next'

import { MAX_BACKUP_REQUEST_BYTES } from './utils/full-backup-archive'
import { singleDeploymentConfig } from './utils/single-config'

let publicFamily = ''
try {
  publicFamily = JSON.stringify(singleDeploymentConfig(process.env))
} catch {
  // Render setup instructions until the operator supplies valid configuration.
}

const nextConfig: NextConfig = {
  // Keep standalone builds and file tracing within this installation.
  outputFileTracingRoot: process.cwd(),
  // Proxy otherwise truncates multipart backups at its default 10 MiB buffer.
  experimental: { proxyClientMaxBodySize: MAX_BACKUP_REQUEST_BYTES },
  env: { NEXT_PUBLIC_FAMILY_CONFIG: publicFamily },
  output: process.env.BUILD_STANDALONE === '1' ? 'standalone' : undefined,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains'
          }
        ]
      }
    ]
  }
}

export default nextConfig
