import { MemorialDate } from '@/types/intake'

export const MEMORIAL_FIELDS = [
  'memorial_day',
  'memorial_month',
  'memorial_calendar',
  'memorial_is_leap_month',
  'memorial_note'
] as const

export function isValidMemorial(
  row: MemorialDate & { is_deceased?: boolean }
): boolean {
  const {
    memorial_day: day,
    memorial_month: month,
    memorial_calendar: calendar
  } = row
  if (
    row.memorial_is_leap_month != null &&
    typeof row.memorial_is_leap_month !== 'boolean'
  )
    return false
  if (day == null && month == null && calendar == null)
    return !row.memorial_is_leap_month && row.memorial_note == null
  if (
    !row.is_deceased ||
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    !day ||
    !month ||
    month < 1 ||
    month > 12 ||
    day < 1
  )
    return false
  if (calendar !== 'lunar' && calendar !== 'solar') return false
  if (
    row.memorial_note != null &&
    (typeof row.memorial_note !== 'string' || row.memorial_note.length > 1000)
  )
    return false
  if (calendar === 'solar')
    return (
      !row.memorial_is_leap_month && day <= new Date(2000, month, 0).getDate()
    )
  return day <= 30
}

export function emptyMemorial(): MemorialDate {
  return {
    memorial_day: null,
    memorial_month: null,
    memorial_calendar: null,
    memorial_is_leap_month: false,
    memorial_note: null
  }
}

export function formatMemorial(row: MemorialDate): string | null {
  if (!row.memorial_day || !row.memorial_month) return null
  return `${String(row.memorial_day).padStart(2, '0')}/${String(row.memorial_month).padStart(2, '0')}${row.memorial_is_leap_month ? ' nhuận' : ''} ${row.memorial_calendar === 'solar' ? 'DL' : 'ÂL'}`
}
