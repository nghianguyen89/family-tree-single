const SUPABASE_STORAGE_MARKER = '/storage/v1/object/'

/**
 * Normalize legacy public/signed URLs and new path-only values to an avatar
 * object path. External URLs are rejected so database input cannot turn into
 * arbitrary browser-side tracking requests.
 */
export function getAvatarStoragePath(value: string | null | undefined) {
  if (!value) return null

  try {
    const url = new URL(value)
    const markerIndex = url.pathname.indexOf(SUPABASE_STORAGE_MARKER)
    if (markerIndex < 0) return null

    const storagePath = url.pathname.slice(
      markerIndex + SUPABASE_STORAGE_MARKER.length
    )
    const [accessType, bucket, ...segments] = storagePath.split('/')
    if (
      !['public', 'sign', 'authenticated'].includes(accessType) ||
      bucket !== 'avatars'
    ) {
      return null
    }

    const path = segments.join('/')
    return path && !path.includes('..') ? path : null
  } catch {
    const path = value.replace(/^\/+/, '')
    return path && !path.includes('..') ? path : null
  }
}

export function getAvatarUrl(value: string | null | undefined) {
  const path = getAvatarStoragePath(value)
  return path ? `/api/avatar?path=${encodeURIComponent(path)}` : null
}
