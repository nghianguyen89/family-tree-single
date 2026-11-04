import type { TranslationKey, TranslationValues } from '@/lib/i18n/messages'

import { hasAncestryCycle } from './lineage'
import { isValidMemorial } from './memorial'
import { hasValidPersonYearRanges } from './yearRanges'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_PERSONS = 10000
const MAX_RELATIONSHIPS = 30000
const MAX_PRIVATE_DETAILS = 10000
const MAX_CUSTOM_EVENTS = 10000
const MAX_BRANCHES = 10000
const MAX_BRANCH_MEMBERS = 30000

function isShortText(value: unknown, maxLength: number) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.length <= maxLength)
  )
}

type Translator = (key: TranslationKey, values?: TranslationValues) => string

function isOptionalInteger(value: unknown, min: number, max: number) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= min &&
      value <= max)
  )
}

function isCalendarDate(year: number, month: number, day: number) {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

export function validateImportPayload(
  input: unknown,
  t: Translator
): string | null {
  if (!input || typeof input !== 'object') return t('invalidData')
  const payload = input as Record<string, unknown>
  const persons = payload.persons
  const relationships = payload.relationships

  if (!Array.isArray(persons) || !Array.isArray(relationships)) {
    return t('invalidDataStructure')
  }
  if (persons.length === 0) return t('emptyBackup')
  if (persons.length > MAX_PERSONS)
    return t('tooManyPersons', { count: MAX_PERSONS })
  if (relationships.length > MAX_RELATIONSHIPS)
    return t('tooManyRelationships', { count: MAX_RELATIONSHIPS })

  const personIds = new Set<string>()
  const ownedPersonBranches = new Map<string, string>()
  for (const person of persons) {
    if (!person || typeof person !== 'object') return t('invalidPersonRecord')
    const row = person as Record<string, unknown>
    if (typeof row.id !== 'string' || !UUID_PATTERN.test(row.id))
      return t('invalidPersonId')
    if (personIds.has(row.id)) return t('duplicatePersonId')
    personIds.add(row.id)
    if (row.family_branch_id != null) {
      if (
        typeof row.family_branch_id !== 'string' ||
        !UUID_PATTERN.test(row.family_branch_id)
      )
        return t('invalidPersonRecord')
      ownedPersonBranches.set(row.id, row.family_branch_id)
      if (row.generation != null) return t('invalidPersonRecord')
    }
    if (
      typeof row.full_name !== 'string' ||
      row.full_name.trim().length === 0 ||
      row.full_name.length > 200
    ) {
      return t('invalidPersonName')
    }
    if (!['male', 'female', 'other'].includes(String(row.gender)))
      return t('invalidGender')
    for (const field of ['is_deceased', 'is_in_law']) {
      if (row[field] != null && typeof row[field] !== 'boolean')
        return t('invalidPersonRecord')
    }
    for (const prefix of ['birth', 'death', 'death_lunar']) {
      if (
        !isOptionalInteger(row[`${prefix}_year`], 1, 9999) ||
        !isOptionalInteger(row[`${prefix}_month`], 1, 12) ||
        !isOptionalInteger(
          row[`${prefix}_day`],
          1,
          prefix === 'death_lunar' ? 30 : 31
        )
      )
        return t('invalidPersonRecord')
      const year = row[`${prefix}_year`]
      const month = row[`${prefix}_month`]
      const day = row[`${prefix}_day`]
      if (
        prefix !== 'death_lunar' &&
        typeof year === 'number' &&
        typeof month === 'number' &&
        typeof day === 'number' &&
        !isCalendarDate(year, month, day)
      )
        return t('invalidPersonRecord')
    }
    if (!hasValidPersonYearRanges(row) || !isValidMemorial(row))
      return t('invalidPersonRecord')
    for (const field of ['generation', 'birth_order']) {
      if (!isOptionalInteger(row[field], 1, 10000))
        return t('invalidPersonRecord')
    }
    for (const field of ['other_names', 'avatar_url', 'note']) {
      if (!isShortText(row[field], 2000)) return t('fieldTooLong', { field })
    }
  }

  const branches = payload.family_branches ?? []
  const members = payload.family_branch_members ?? []
  if (
    !Array.isArray(branches) ||
    branches.length > MAX_BRANCHES ||
    !Array.isArray(members) ||
    members.length > MAX_BRANCH_MEMBERS
  ) {
    return t('invalidDataStructure')
  }
  const branchIds = new Set<string>()
  const branchAnchors = new Map<string, string>()
  const branchRoots = new Map<string, string | null>()
  const branchPartners = new Map<string, string>()
  for (const branch of branches) {
    if (!branch || typeof branch !== 'object') return t('invalidDataStructure')
    const row = branch as Record<string, unknown>
    if (
      typeof row.id !== 'string' ||
      !UUID_PATTERN.test(row.id) ||
      branchIds.has(row.id) ||
      typeof row.name !== 'string' ||
      !row.name.trim() ||
      row.name.length > 150 ||
      typeof row.anchor_person_id !== 'string' ||
      !personIds.has(row.anchor_person_id) ||
      (row.partner_person_id != null &&
        (typeof row.partner_person_id !== 'string' ||
          !UUID_PATTERN.test(row.partner_person_id) ||
          !personIds.has(row.partner_person_id) ||
          ownedPersonBranches.has(row.partner_person_id) ||
          row.partner_person_id === row.anchor_person_id)) ||
      (row.root_person_id != null &&
        (typeof row.root_person_id !== 'string' ||
          !personIds.has(row.root_person_id)))
    ) {
      return t('invalidDataStructure')
    }
    branchIds.add(row.id)
    branchAnchors.set(row.id, row.anchor_person_id)
    branchRoots.set(row.id, (row.root_person_id as string | null) ?? null)
    if (typeof row.partner_person_id === 'string')
      branchPartners.set(row.id, row.partner_person_id)
  }
  for (const branchId of ownedPersonBranches.values()) {
    if (!branchIds.has(branchId)) return t('invalidDataStructure')
  }
  const memberKeys = new Set<string>()
  for (const member of members) {
    if (!member || typeof member !== 'object') return t('invalidDataStructure')
    const row = member as Record<string, unknown>
    if (
      typeof row.branch_id !== 'string' ||
      !branchIds.has(row.branch_id) ||
      typeof row.person_id !== 'string' ||
      !personIds.has(row.person_id) ||
      !isOptionalInteger(row.generation, 1, 10000)
    )
      return t('invalidDataStructure')
    const key = `${row.branch_id}:${row.person_id}`
    if (memberKeys.has(key)) return t('invalidDataStructure')
    memberKeys.add(key)
  }
  for (const [personId, branchId] of ownedPersonBranches) {
    if (!memberKeys.has(`${branchId}:${personId}`))
      return t('invalidDataStructure')
  }
  for (const [branchId, anchorId] of branchAnchors) {
    if (!memberKeys.has(`${branchId}:${anchorId}`))
      return t('invalidDataStructure')
    const rootId = branchRoots.get(branchId)
    if (rootId && !memberKeys.has(`${branchId}:${rootId}`))
      return t('invalidDataStructure')
  }

  const relationshipKeys = new Set<string>()
  const mainMarriages = new Set<string>()
  for (const relationship of relationships) {
    if (!relationship || typeof relationship !== 'object')
      return t('invalidRelationship')
    const row = relationship as Record<string, unknown>
    if (
      row.family_branch_id != null &&
      (typeof row.family_branch_id !== 'string' ||
        !branchIds.has(row.family_branch_id))
    )
      return t('invalidRelationshipData')
    if (
      row.family_branch_id != null &&
      (!memberKeys.has(`${row.family_branch_id}:${row.person_a}`) ||
        !memberKeys.has(`${row.family_branch_id}:${row.person_b}`))
    )
      return t('invalidRelationshipData')
    if (
      typeof row.person_a !== 'string' ||
      !personIds.has(row.person_a) ||
      typeof row.person_b !== 'string' ||
      !personIds.has(row.person_b) ||
      row.person_a === row.person_b ||
      !['marriage', 'biological_child', 'adopted_child'].includes(
        String(row.type)
      )
    )
      return t('invalidRelationshipData')
    if (!isShortText(row.note, 2000)) return t('relationshipNoteTooLong')
    const key = `${row.person_a}:${row.person_b}:${row.type}:${row.family_branch_id ?? ''}`
    if (relationshipKeys.has(key)) return t('invalidRelationshipData')
    relationshipKeys.add(key)
    if (row.type === 'marriage' && row.family_branch_id == null) {
      mainMarriages.add(`${row.person_a}:${row.person_b}`)
      mainMarriages.add(`${row.person_b}:${row.person_a}`)
    }
  }

  for (const [branchId, partnerId] of branchPartners) {
    const anchorId = branchAnchors.get(branchId)!
    if (
      ownedPersonBranches.has(anchorId) ||
      !mainMarriages.has(`${anchorId}:${partnerId}`)
    )
      return t('invalidDataStructure')
  }

  if (hasAncestryCycle(relationships)) return t('lineageCycleError')

  const privateDetails = payload.person_details_private
  if (privateDetails !== undefined) {
    if (
      !Array.isArray(privateDetails) ||
      privateDetails.length > MAX_PRIVATE_DETAILS
    ) {
      return t('privateDetailsLimit')
    }
    const detailIds = new Set<string>()
    for (const detail of privateDetails) {
      if (!detail || typeof detail !== 'object')
        return t('invalidPrivateDetails')
      const row = detail as Record<string, unknown>
      if (typeof row.person_id !== 'string' || !personIds.has(row.person_id))
        return t('invalidPrivateDetailsPerson')
      if (detailIds.has(row.person_id)) return t('invalidPrivateDetailsPerson')
      detailIds.add(row.person_id)
      for (const field of ['phone_number', 'occupation', 'current_residence']) {
        if (!isShortText(row[field], 500)) return t('fieldTooLong', { field })
      }
    }
  }

  const customEvents = payload.custom_events
  if (customEvents !== undefined) {
    if (
      !Array.isArray(customEvents) ||
      customEvents.length > MAX_CUSTOM_EVENTS
    ) {
      return t('eventsLimit')
    }
    const eventIds = new Set<string>()
    for (const event of customEvents) {
      if (!event || typeof event !== 'object') return t('invalidEvent')
      const row = event as Record<string, unknown>
      if (typeof row.id !== 'string' || !UUID_PATTERN.test(row.id))
        return t('invalidEventId')
      if (eventIds.has(row.id)) return t('invalidEventId')
      eventIds.add(row.id)
      if (
        typeof row.event_date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.event_date) ||
        Number(row.event_date.slice(0, 4)) < 1 ||
        !isCalendarDate(
          Number(row.event_date.slice(0, 4)),
          Number(row.event_date.slice(5, 7)),
          Number(row.event_date.slice(8, 10))
        )
      )
        return t('invalidEvent')
      if (
        typeof row.name !== 'string' ||
        row.name.trim().length === 0 ||
        row.name.length > 200
      )
        return t('invalidEventName')
      for (const field of ['content', 'location']) {
        if (!isShortText(row[field], 2000)) return t('fieldTooLong', { field })
      }
    }
  }
  return null
}
