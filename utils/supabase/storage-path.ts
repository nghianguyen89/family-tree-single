export function getGalleryStoragePath(value: string): string {
  if (!value) return value

  try {
    const url = new URL(value)
    const marker = '/storage/v1/object/'
    const markerIndex = url.pathname.indexOf(marker)
    if (markerIndex >= 0) {
      const path = url.pathname.slice(markerIndex + marker.length)
      const [accessType, bucket, ...segments] = path.split('/')
      if (
        !['public', 'sign', 'authenticated'].includes(accessType) ||
        bucket !== 'gallery'
      ) {
        return ''
      }
      return decodeURIComponent(segments.join('/'))
    }
    return ''
  } catch {
    // The value is already a storage path.
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return ''

  return value.replace(/^\/+/, '')
}
