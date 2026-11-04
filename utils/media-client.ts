import { contentUploadErrorText } from '@/lib/i18n/content'
import type { MediaAsset } from '@/types/media'

export async function uploadMediaAsset(
  file: File,
  libraryVisible: boolean,
  locale = 'vi'
): Promise<{ asset: MediaAsset; reused: boolean }> {
  const form = new FormData()
  form.set('file', file)
  form.set('library_visible', String(libraryVisible))
  let response: Response
  try {
    response = await fetch('/api/media/upload', { method: 'POST', body: form })
  } catch {
    throw new Error(contentUploadErrorText('network', locale))
  }
  const result = await response.json().catch(() => null)
  if (!response.ok || !result?.asset)
    throw new Error(
      contentUploadErrorText(
        response.redirected ? 'permission' : result?.error,
        locale,
        response.status
      )
    )
  return result
}
