export function imageFileTitle(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 200) || 'Image'
  )
}

/** MIME-less browser files are accepted by extension; the server/storage still validates uploads. */
export function imageFileProblem(
  file: File,
  maxBytes: number,
  allowedTypes: readonly string[]
): 'size' | 'invalid' | null {
  if (!file.size || file.size > maxBytes) return 'size'
  const aliases: Record<string, string> = {
    'image/jpg': 'image/jpeg',
    'image/pjpeg': 'image/jpeg'
  }
  const extensions: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif'
  }
  const mime = file.type.toLowerCase()
  const type =
    !mime || mime === 'application/octet-stream'
      ? extensions[file.name.split('.').pop()?.toLowerCase() || '']
      : aliases[mime] || mime
  return allowedTypes.includes(type) ? null : 'invalid'
}
