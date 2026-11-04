// Input and encoded upload limits are deliberately separate: the original
// stays on the user's device; only the bounded result is sent to Storage.
export const MAX_SOURCE_IMAGE_BYTES = 50 * 1024 * 1024
export const AUTO_COMPRESS_IMAGE_BYTES = 4 * 1024 * 1024

export class ImageCompressionError extends Error {}

/** Keep small files unchanged. Large images become still WebP (PNG fallback). */
export async function compressUploadImage(
  file: File,
  maxBytes = AUTO_COMPRESS_IMAGE_BYTES
): Promise<File> {
  if (!file.size || file.size > MAX_SOURCE_IMAGE_BYTES)
    throw new ImageCompressionError('source-size')
  const limit = Math.min(maxBytes, AUTO_COMPRESS_IMAGE_BYTES)
  if (file.size <= limit) return file
  let bitmap: ImageBitmap | undefined
  const canvas = document.createElement('canvas')
  try {
    bitmap = await createImageBitmap(file)
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width * bitmap.height > 80_000_000
    )
      throw new ImageCompressionError('dimensions')
    const context = canvas.getContext('2d')
    if (!context) throw new ImageCompressionError('canvas')
    const scale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height))
    let width = Math.max(1, Math.round(bitmap.width * scale))
    let height = Math.max(1, Math.round(bitmap.height * scale))
    // Leave space below the upload cap; reduce quality before image dimensions.
    const target = Math.floor(limit * 0.95)
    for (let step = 0; step < 12; step++) {
      canvas.width = width
      canvas.height = height
      context.drawImage(bitmap, 0, 0, width, height)
      for (const quality of [0.92, 0.84, 0.74]) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/webp', quality)
        )
        if (
          blob &&
          blob.size > 0 &&
          blob.size <= target &&
          ['image/webp', 'image/png'].includes(blob.type)
        ) {
          const extension = blob.type === 'image/webp' ? 'webp' : 'png'
          const base = file.name.replace(/\.[^.]+$/, '') || 'image'
          return new File([blob], `${base}.${extension}`, {
            type: blob.type,
            lastModified: file.lastModified
          })
        }
        // PNG fallback has no quality setting; go straight to resizing.
        if (blob?.type === 'image/png') break
      }
      width = Math.max(1, Math.floor(width * 0.8))
      height = Math.max(1, Math.floor(height * 0.8))
    }
    throw new ImageCompressionError('encode')
  } catch (error) {
    throw error instanceof ImageCompressionError
      ? error
      : new ImageCompressionError('decode')
  } finally {
    bitmap?.close()
    canvas.width = canvas.height = 0
  }
}
