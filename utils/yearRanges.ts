import { Person } from '@/types'

export function isValidYearRange(start: unknown, end: unknown): boolean {
  return (
    typeof start === 'number' &&
    typeof end === 'number' &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 1 &&
    end <= 9999 &&
    start <= end
  )
}

// Empty exact-date fields prevent estimates from becoming ages or anniversaries.
export function hasValidPersonYearRanges(
  row: Record<string, unknown>
): boolean {
  for (const prefix of ['birth', 'death']) {
    const start = row[`${prefix}_year_from`]
    const end = row[`${prefix}_year_to`]
    if (start == null && end == null) continue
    if (!isValidYearRange(start, end)) return false
    const exact = [`${prefix}_year`, `${prefix}_month`, `${prefix}_day`]
    if (prefix === 'death') {
      exact.push('death_lunar_year', 'death_lunar_month', 'death_lunar_day')
      if (row.is_deceased !== true) return false
    }
    if (exact.some((field) => row[field] != null)) return false
  }
  const earliestBirth = row.birth_year_from ?? row.birth_year
  const latestDeath = row.death_year_to ?? row.death_year
  return !(
    typeof earliestBirth === 'number' &&
    typeof latestDeath === 'number' &&
    latestDeath < earliestBirth
  )
}

export function formatPersonYear(
  person: Partial<Person>,
  prefix: 'birth' | 'death',
  unknown = '...'
): string {
  const from = person[`${prefix}_year_from`]
  const to = person[`${prefix}_year_to`]
  if (from != null && to != null) return `≈ ${from}–${to}`
  const year =
    prefix === 'birth'
      ? person.birth_year
      : person.death_lunar_year || person.death_year
  return year ? String(year) : unknown
}
