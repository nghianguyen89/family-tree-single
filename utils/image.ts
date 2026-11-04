const AVATAR_MAX_DIMENSION = 512

/**
 * Downscales an avatar in the browser before upload. Avatars are displayed at
 * 64px or less, so storing multi-megabyte originals only slows down every tree
 * view. Returns the original file if it is already small or if the browser
 * cannot decode it.
 */
export async function resizeAvatar(
  file: File,
  maxDimension = AVATAR_MAX_DIMENSION
): Promise<File> {
  // Keep small GIFs untouched so animations survive
  if (file.type === 'image/gif' && file.size <= 2 * 1024 * 1024) return file

  try {
    const bitmap = await createImageBitmap(file)
    const ratio = Math.min(
      1,
      maxDimension / Math.max(bitmap.width, bitmap.height)
    )

    if (ratio === 1 && file.size <= 300 * 1024) {
      bitmap.close()
      return file
    }

    const width = Math.round(bitmap.width * ratio)
    const height = Math.round(bitmap.height * ratio)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return file
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.85)
    )
    // Safari < 16 can't encode WebP and silently falls back to PNG
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) {
      return file
    }

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'avatar'
    return new File([blob], `${baseName}.webp`, { type: 'image/webp' })
  } catch {
    return file
  }
}
