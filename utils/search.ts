/**
 * Normalizes text for accent-insensitive Vietnamese search:
 * "Nguyễn Văn Đức" -> "nguyen van duc".
 */
export function normalizeSearchText(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
