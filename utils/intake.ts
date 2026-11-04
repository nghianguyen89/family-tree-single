import { Lunar } from 'lunar-javascript'

import { IntakePayload, IntakePersonData } from '@/types/intake'
import { isValidMemorial } from '@/utils/memorial'
import { hasValidPersonYearRanges } from '@/utils/yearRanges'

export const INTAKE_FIELDS = [
  'full_name',
  'gender',
  'birth_year',
  'birth_month',
  'birth_day',
  'birth_year_from',
  'birth_year_to',
  'death_year',
  'death_month',
  'death_day',
  'death_year_from',
  'death_year_to',
  'death_lunar_year',
  'death_lunar_month',
  'death_lunar_day',
  'is_deceased',
  'other_names',
  'note',
  'memorial_day',
  'memorial_month',
  'memorial_calendar',
  'memorial_is_leap_month',
  'memorial_note'
] as const
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const INTAKE_TOKEN = /^[0-9a-f]{64}$/

export function validateIntake(payload: unknown): payload is IntakePayload {
  if (!payload || typeof payload !== 'object') return false
  const p = payload as IntakePayload
  if (
    !UUID.test(p.anchor_id || '') ||
    typeof p.sender_name !== 'string' ||
    !p.sender_name.trim() ||
    p.sender_name.length > 200 ||
    typeof p.sender_contact !== 'string' ||
    !p.sender_contact.trim() ||
    p.sender_contact.length > 200 ||
    typeof p.note !== 'string' ||
    p.note.length > 2000 ||
    !Array.isArray(p.people) ||
    p.people.length < 1 ||
    p.people.length > 30
  )
    return false
  const seen = new Set<string>(['anchor'])
  for (const row of p.people) {
    if (
      row?.generation != null &&
      (!Number.isInteger(row.generation) ||
        row.generation < 1 ||
        row.generation > 10000)
    )
      return false
    if (
      !row ||
      !UUID.test(row.client_id) ||
      seen.has(row.client_id) ||
      !['child', 'spouse', 'self'].includes(row.relation) ||
      !seen.has(row.relative_to)
    )
      return false
    if (
      row.relation === 'self' &&
      (row.relative_to !== 'anchor' || row.other_parent_ref)
    )
      return false
    if (
      row.other_parent_ref &&
      (row.relation !== 'child' ||
        !seen.has(row.other_parent_ref) ||
        row.other_parent_ref === row.relative_to)
    )
      return false
    const d = row.data
    if (
      !d ||
      typeof d.full_name !== 'string' ||
      !d.full_name.trim() ||
      d.full_name.length > 200 ||
      !['male', 'female', 'other'].includes(d.gender) ||
      typeof d.is_deceased !== 'boolean'
    )
      return false
    if (
      Object.keys(d).some(
        (k) => !(INTAKE_FIELDS as readonly string[]).includes(k)
      )
    )
      return false
    for (const field of ['other_names', 'note'] as const)
      if (
        d[field] != null &&
        (typeof d[field] !== 'string' || d[field]!.length > 2000)
      )
        return false
    for (const prefix of ['birth', 'death', 'death_lunar'] as const) {
      const year = d[`${prefix}_year`],
        month = d[`${prefix}_month`],
        day = d[`${prefix}_day`]
      for (const [value, max] of [
        [year, 9999],
        [month, 12],
        [day, prefix === 'death_lunar' ? 30 : 31]
      ]) {
        if (
          value != null &&
          (!Number.isInteger(value) || value < 1 || value > max!)
        )
          return false
      }
      if (
        month &&
        day &&
        prefix !== 'death_lunar' &&
        day > new Date(year || 2000, month, 0).getDate()
      )
        return false
      if (year && month && day && prefix === 'death_lunar') {
        try {
          const lunar = Lunar.fromYmd(year, month, day)
          if (lunar.getDay() !== day || lunar.getMonth() !== month) return false
        } catch {
          return false
        }
      }
    }
    if (
      !d.is_deceased &&
      Object.entries(d).some(([k, v]) => k.startsWith('death_') && v != null)
    )
      return false
    if (
      !hasValidPersonYearRanges(d as unknown as Record<string, unknown>) ||
      !isValidMemorial(d)
    )
      return false
    seen.add(row.client_id)
  }
  return true
}

export function cleanPublicIntake(payload: IntakePayload): IntakePayload {
  return {
    anchor_id: payload.anchor_id,
    sender_name: payload.sender_name.trim(),
    sender_contact: payload.sender_contact.trim(),
    note: payload.note,
    people: payload.people.map((row) => ({
      client_id: row.client_id,
      relation: row.relation,
      relative_to: row.relative_to,
      other_parent_ref: row.other_parent_ref || null,
      data: Object.fromEntries(
        INTAKE_FIELDS.filter((field) => row.data[field] !== undefined).map(
          (field) => [field, row.data[field]]
        )
      ) as IntakePersonData
    }))
  }
}
