export interface CropPosition {
  x: number
  y: number
}

/** Source pixels, clamped so the square never extends beyond the image. */
export function getAvatarCrop(
  width: number,
  height: number,
  zoom: number,
  position: CropPosition
) {
  const size = Math.min(width, height) / Math.max(1, zoom)
  return {
    x: Math.max(0, Math.min(width - size, position.x * width - size / 2)),
    y: Math.max(0, Math.min(height - size, position.y * height - size / 2)),
    size
  }
}

export async function exportAvatarCrop(
  image: HTMLImageElement,
  fileName: string,
  zoom: number,
  position: CropPosition
): Promise<File> {
  const crop = getAvatarCrop(
    image.naturalWidth,
    image.naturalHeight,
    zoom,
    position
  )
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = Math.max(
    1,
    Math.min(512, Math.round(crop.size))
  )
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.size,
    crop.size,
    0,
    0,
    canvas.width,
    canvas.height
  )
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.9)
  )
  if (!blob || blob.size > 2 * 1024 * 1024)
    throw new Error('Crop export failed')
  const extension = blob.type === 'image/webp' ? 'webp' : 'png'
  return new File(
    [blob],
    `${fileName.replace(/\.[^.]+$/, '') || 'avatar'}-crop.${extension}`,
    { type: blob.type }
  )
}
