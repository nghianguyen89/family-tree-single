import type { GalleryItem } from '@/types'
import { compressUploadImage } from '@/utils/image-compression'
import { imageFileTitle } from '@/utils/image-upload'
import { createClient } from '@/utils/supabase/client'
import { uploadGalleryImage } from '@/utils/supabase/storage'
import { getGalleryStoragePath } from '@/utils/supabase/storage-path'

/** Save one gallery image; the shared queue handles batches and partial failures. */
export async function saveGalleryImage(
  file: File | null,
  details?: { title: string; description: string; eventDate: string },
  existing?: GalleryItem
) {
  const db = createClient()
  const { data, error } = await db.auth.getUser()
  if (error || !data.user) throw new Error('permission')
  let uploadedPath: string | null = null
  try {
    const oldPath =
      existing?.storage_path || getGalleryStoragePath(existing?.image_url || '')
    let path = oldPath
    if (file) {
      const uploaded = await uploadGalleryImage(await compressUploadImage(file))
      if (uploaded.error || !uploaded.path) throw new Error('upload')
      uploadedPath = path = uploaded.path
    }
    if (!path) throw new Error('upload')
    const value = {
      title: details?.title.trim() || imageFileTitle(file?.name || ''),
      description: details?.description || null,
      event_date: details?.eventDate || null,
      image_url: path
    }
    const result = existing
      ? await db
          .from('gallery_items')
          .update(value)
          .eq('id', existing.id)
          .select('id')
          .single()
      : await db
          .from('gallery_items')
          .insert({ ...value, created_by: data.user.id })
          .select('id')
          .single()
    if (result.error) throw new Error('save')
    // Only remove the previous file after the replacement has been saved.
    if (uploadedPath && oldPath && oldPath !== uploadedPath) {
      await db.storage
        .from('gallery')
        .remove([oldPath])
        .catch(() => {})
    }
  } catch (error) {
    if (uploadedPath)
      await db.storage
        .from('gallery')
        .remove([uploadedPath])
        .catch(() => {})
    throw error
  }
}
