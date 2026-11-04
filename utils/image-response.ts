import { contentImageMime } from './content'

/** Some server fetch responses lose Blob.type; inspect bytes rather than the filename. */
export async function downloadedImageMime(data: Blob): Promise<string | null> {
  const mime = data.type.split(';', 1)[0].trim().toLowerCase()
  if (mime && mime !== 'application/octet-stream') return mime
  const bytes = new Uint8Array(await data.slice(0, 12).arrayBuffer())
  return (
    contentImageMime(bytes) ||
    (/^GIF8[79]a/.test(new TextDecoder().decode(bytes.slice(0, 6)))
      ? 'image/gif'
      : null)
  )
}
