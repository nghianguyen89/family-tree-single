import type { ContentInput, HomeSettings } from '@/types/content'

export const CONTENT_UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export const MAX_CONTENT_IMAGE_BYTES = 4 * 1024 * 1024
export const CONTENT_KINDS = ['article', 'announcement', 'album'] as const
export const CONTENT_CATEGORIES = [
  'history',
  'family',
  'activities',
  'news'
] as const
export const HOME_SECTIONS = ['announcements', 'articles', 'albums'] as const

const text = (v: unknown, max: number) =>
  typeof v === 'string' && v.length <= max
const date = (v: unknown) =>
  v === null ||
  (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)))

export function validateContent(v: unknown): v is ContentInput {
  if (!v || typeof v !== 'object') return false
  const p = v as ContentInput
  return (
    CONTENT_KINDS.includes(p.kind) &&
    text(p.title, 200) &&
    !!p.title.trim() &&
    text(p.summary, 600) &&
    text(p.body, 100000) &&
    CONTENT_CATEGORIES.includes(
      p.category as (typeof CONTENT_CATEGORIES)[number]
    ) &&
    ['draft', 'published'].includes(p.status) &&
    ['public', 'internal'].includes(p.visibility) &&
    typeof p.is_featured === 'boolean' &&
    text(p.location, 500) &&
    date(p.publish_at) &&
    date(p.expires_at) &&
    date(p.event_start) &&
    date(p.event_end) &&
    (p.status !== 'published' || p.publish_at !== null) &&
    (p.status !== 'published' ||
      p.kind !== 'announcement' ||
      p.event_start !== null) &&
    (p.expires_at === null ||
      p.publish_at === null ||
      Date.parse(p.expires_at) > Date.parse(p.publish_at)) &&
    (p.event_end === null ||
      (p.event_start !== null &&
        Date.parse(p.event_end) >= Date.parse(p.event_start)))
  )
}

export function validateHomeSettings(v: unknown): v is HomeSettings {
  if (!v || typeof v !== 'object') return false
  const p = v as HomeSettings
  return (
    text(p.title, 200) &&
    !!p.title.trim() &&
    text(p.subtitle, 600) &&
    text(p.origin, 300) &&
    (p.origin_previous === undefined || text(p.origin_previous, 300)) &&
    text(p.introduction, 20000) &&
    text(p.contact, 2000) &&
    (p.cover_image_id === null ||
      (typeof p.cover_image_id === 'string' &&
        CONTENT_UUID.test(p.cover_image_id))) &&
    Array.isArray(p.section_order) &&
    p.section_order.length === 3 &&
    new Set(p.section_order).size === 3 &&
    p.section_order.every((s) => HOME_SECTIONS.includes(s))
  )
}

// All editorial dates are explicitly entered in Vietnam time, independent of device time zone.
export function toContentDate(value: string): string | null {
  if (!value) return null
  const parsed = new Date(`${value}:00+07:00`)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

export function toContentLocal(value: string | null): string {
  if (!value) return ''
  return new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0, 16)
}

export function formatContentDate(
  value: string,
  locale: string,
  withTime = false
) {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  }).format(new Date(value))
}

export function contentImageUrl(id: string) {
  return `/api/content/image?id=${id}`
}

export function contentImageMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return 'image/jpeg'
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
  )
    return 'image/png'
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp'
  return null
}
