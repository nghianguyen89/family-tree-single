export function isContentUploadSameOrigin(request: Request) {
  const url = new URL(request.url)
  // Next may normalize request.url to localhost even when the browser uses
  // 127.0.0.1 or a LAN hostname. Host is the authority the browser requested.
  // Do not trust a separate X-Forwarded-Host supplied by a client.
  const expectedOrigin = `${url.protocol}//${request.headers.get('host') || url.host}`
  return request.headers.get('origin') === expectedOrigin
}

export function contentUploadFailure(
  error: {
    code?: string
    status?: number
    statusCode?: string | number
    message?: string
  },
  stage: 'storage' | 'database'
) {
  const status = Number(error.statusCode || error.status)
  const message = (error.message || '').toLowerCase()
  if (stage === 'database') {
    if (['42P01', 'PGRST205', 'PGRST204'].includes(error.code || ''))
      return 'schema'
    if (error.code === '42501') return 'databasePermission'
    if (error.code === '23503') return 'notFound'
    return 'save'
  }
  if (
    status === 413 ||
    message.includes('maximum allowed size') ||
    message.includes('too large')
  )
    return 'size'
  if (message.includes('mime') || message.includes('content type'))
    return 'type'
  if (
    message.includes('bucket') &&
    (status === 404 || message.includes('not found'))
  )
    return 'bucket'
  if (
    status === 401 ||
    status === 403 ||
    message.includes('row-level security') ||
    message.includes('not authorized')
  )
    return 'storagePermission'
  return 'upload'
}

export function mediaUploadFailure(
  error: Parameters<typeof contentUploadFailure>[0],
  stage: 'storage' | 'database'
) {
  const code = contentUploadFailure(error, stage)
  return (
    (
      {
        storagePermission: 'mediaStoragePermission',
        bucket: 'mediaBucket',
        schema: 'mediaSchema'
      } as Record<string, string>
    )[code] || code
  )
}
