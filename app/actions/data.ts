'use server'

import { revalidatePath } from 'next/cache'

import { getServerTranslations } from '@/lib/i18n/server'
import { Relationship } from '@/types'
import { validateImportPayload } from '@/utils/backup-validation'
import { fetchAllRows } from '@/utils/supabase/fetchAll'
import { getIsAdmin, getSupabase } from '@/utils/supabase/queries'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Payload shape cho file backup JSON.
 * Các field DB-managed (created_at, updated_at) được giữ để tham khảo
 * nhưng sẽ bị loại bỏ khi import lại.
 */
interface PersonExport {
  id: string
  family_branch_id?: string | null
  full_name: string
  gender: 'male' | 'female' | 'other'
  memorial_day?: number | null
  memorial_month?: number | null
  memorial_calendar?: 'lunar' | 'solar' | null
  memorial_is_leap_month?: boolean
  memorial_note?: string | null
  birth_year_from?: number | null
  birth_year_to?: number | null
  death_year_from?: number | null
  death_year_to?: number | null
  birth_year: number | null
  birth_month: number | null
  birth_day: number | null
  death_year: number | null
  death_month: number | null
  death_day: number | null
  death_lunar_year: number | null
  death_lunar_month: number | null
  death_lunar_day: number | null
  is_deceased: boolean
  is_in_law: boolean
  birth_order: number | null
  generation: number | null
  other_names: string | null
  avatar_url: string | null
  note: string | null
  // DB-managed fields (kept in export for traceability, stripped on import)
  created_at?: string
  updated_at?: string
}

interface RelationshipExport {
  id?: string
  family_branch_id?: string | null
  type: string
  person_a: string
  person_b: string
  note?: string | null
  created_at?: string
  updated_at?: string
}

interface PersonDetailsPrivateExport {
  person_id: string
  phone_number: string | null
  occupation: string | null
  current_residence: string | null
}

interface CustomEventExport {
  id: string
  name: string
  content: string | null
  event_date: string
  location: string | null
  created_by: string | null
}

interface FamilyBranchExport {
  id: string
  name: string
  anchor_person_id: string
  partner_person_id?: string | null
  root_person_id: string | null
}

interface FamilyBranchMemberExport {
  branch_id: string
  person_id: string
  generation: number | null
}

interface BackupPayload {
  version: number
  timestamp: string
  persons: PersonExport[]
  relationships: RelationshipExport[]
  person_details_private?: PersonDetailsPrivateExport[]
  custom_events?: CustomEventExport[]
  family_branches?: FamilyBranchExport[]
  family_branch_members?: FamilyBranchMemberExport[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Các field được phép insert vào bảng persons (loại bỏ created_at/updated_at)
function sanitizePerson(
  p: PersonExport
): Omit<PersonExport, 'created_at' | 'updated_at'> {
  return {
    id: p.id,
    family_branch_id: p.family_branch_id ?? null,
    full_name: p.full_name,
    gender: p.gender,
    memorial_day: p.memorial_day ?? null,
    memorial_month: p.memorial_month ?? null,
    memorial_calendar: p.memorial_calendar ?? null,
    memorial_is_leap_month: p.memorial_is_leap_month ?? false,
    memorial_note: p.memorial_note ?? null,
    birth_year_from: p.birth_year_from ?? null,
    birth_year_to: p.birth_year_to ?? null,
    death_year_from: p.death_year_from ?? null,
    death_year_to: p.death_year_to ?? null,
    birth_year: p.birth_year ?? null,
    birth_month: p.birth_month ?? null,
    birth_day: p.birth_day ?? null,
    death_year: p.death_year ?? null,
    death_month: p.death_month ?? null,
    death_day: p.death_day ?? null,
    death_lunar_year: p.death_lunar_year ?? null,
    death_lunar_month: p.death_lunar_month ?? null,
    death_lunar_day: p.death_lunar_day ?? null,
    is_deceased: p.is_deceased ?? false,
    is_in_law: p.is_in_law ?? false,
    birth_order: p.birth_order ?? null,
    generation: p.generation ?? null,
    other_names: p.other_names ?? null,
    avatar_url: p.avatar_url ?? null,
    note: p.note ?? null
  }
}

function sanitizeRelationship(
  r: RelationshipExport
): Omit<RelationshipExport, 'id' | 'created_at' | 'updated_at'> {
  return {
    type: r.type,
    family_branch_id: r.family_branch_id ?? null,
    person_a: r.person_a,
    person_b: r.person_b,
    note: r.note ?? null
  }
}

function sanitizeCustomEvent(
  e: CustomEventExport
): Omit<CustomEventExport, 'created_by'> {
  return {
    id: e.id,
    name: e.name,
    content: e.content ?? null,
    event_date: e.event_date,
    location: e.location ?? null
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

export async function exportData(
  exportRootId?: string
): Promise<BackupPayload | { error: string }> {
  const { t } = await getServerTranslations()
  const isAdmin = await getIsAdmin()
  if (!isAdmin) {
    return { error: t('dataAccessDenied') }
  }

  const supabase = await getSupabase()

  // Fetch ALL rows using pagination to avoid the 1000-row Supabase limit.
  // A unique tie-breaker column keeps the page boundaries stable.
  const fetchAll = async <T>(
    table: string,
    selectCols: string,
    orderBy: string,
    tieBreaker = 'id'
  ): Promise<T[]> => {
    const { data, error } = await fetchAllRows<T>((from, to) => {
      let query = supabase
        .from(table)
        .select(selectCols)
        .order(orderBy, { ascending: true })
      if (tieBreaker !== orderBy) query = query.order(tieBreaker)
      return query.range(from, to) as unknown as PromiseLike<{
        data: T[] | null
        error: { message: string } | null
      }>
    })
    if (error) throw new Error(error.message)
    return data
  }

  let allPersons: PersonExport[] = []
  let allRels: RelationshipExport[] = []
  let allPrivateDetails: PersonDetailsPrivateExport[] = []
  let allCustomEvents: CustomEventExport[] = []
  let allBranches: FamilyBranchExport[] = []
  let allBranchMembers: FamilyBranchMemberExport[] = []

  try {
    allPersons = await fetchAll<PersonExport>(
      'persons',
      'id, family_branch_id, full_name, gender, memorial_day, memorial_month, memorial_calendar, memorial_is_leap_month, memorial_note, birth_year_from, birth_year_to, death_year_from, death_year_to, birth_year, birth_month, birth_day, death_year, death_month, death_day, death_lunar_year, death_lunar_month, death_lunar_day, is_deceased, is_in_law, birth_order, generation, other_names, avatar_url, note, created_at, updated_at',
      'created_at'
    )
    allRels = await fetchAll<RelationshipExport>(
      'relationships',
      'id, family_branch_id, type, person_a, person_b, note, created_at, updated_at',
      'created_at'
    )
    // person_details_private might not have created_at, order by person_id
    allPrivateDetails = await fetchAll<PersonDetailsPrivateExport>(
      'person_details_private',
      'person_id, phone_number, occupation, current_residence',
      'person_id',
      'person_id'
    )
    allCustomEvents = await fetchAll<CustomEventExport>(
      'custom_events',
      'id, name, content, event_date, location, created_by',
      'event_date'
    )
    allBranches = await fetchAll<FamilyBranchExport>(
      'family_branches',
      'id, name, anchor_person_id, partner_person_id, root_person_id',
      'id'
    )
    allBranchMembers = await fetchAll<FamilyBranchMemberExport>(
      'family_branch_members',
      'branch_id, person_id, generation',
      'branch_id',
      'person_id'
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return { error: t('loadDataError', { error: message }) }
  }

  let exportPersons = allPersons
  let exportRels = allRels
  let exportPrivateDetails = allPrivateDetails
  let exportBranches = allBranches
  let exportBranchMembers = allBranchMembers
  const exportCustomEvents = allCustomEvents

  // If a root person is selected, filter the export to only their subtree
  if (exportRootId && exportPersons.some((p) => p.id === exportRootId)) {
    const includedPersonIds = new Set<string>([exportRootId])
    const mainPersonIds = new Set(
      allPersons.filter((p) => !p.family_branch_id).map((p) => p.id)
    )

    // Pre-calculate adjacency lists for O(1) lookup to improve performance with large datasets
    const childrenMap = new Map<string, string[]>()
    const spouseMap = new Map<string, string[]>()

    exportRels
      .filter((r) => !r.family_branch_id)
      .forEach((r) => {
        if (r.type === 'biological_child' || r.type === 'adopted_child') {
          if (!mainPersonIds.has(r.person_b)) return
          if (!childrenMap.has(r.person_a)) childrenMap.set(r.person_a, [])
          childrenMap.get(r.person_a)!.push(r.person_b)
        } else if (r.type === 'marriage') {
          if (!mainPersonIds.has(r.person_a) || !mainPersonIds.has(r.person_b))
            return
          if (!spouseMap.has(r.person_a)) spouseMap.set(r.person_a, [])
          if (!spouseMap.has(r.person_b)) spouseMap.set(r.person_b, [])
          spouseMap.get(r.person_a)!.push(r.person_b)
          spouseMap.get(r.person_b)!.push(r.person_a)
        }
      })

    // 1. Traverse biological and adopted children recursively
    const findDescendants = (parentId: string) => {
      const children = childrenMap.get(parentId) || []
      children.forEach((childId) => {
        if (!includedPersonIds.has(childId)) {
          includedPersonIds.add(childId)
          findDescendants(childId)
        }
      })
    }
    findDescendants(exportRootId)

    // 2. Add spouses for everyone in the tree so far
    const descendantsArray = Array.from(includedPersonIds) // snapshot current members
    descendantsArray.forEach((personId) => {
      const spouses = spouseMap.get(personId) || []
      spouses.forEach((spouseId) => {
        includedPersonIds.add(spouseId)
      })
    })

    // Include each branch attached to the selected main subtree. A person can
    // belong to several branches, so repeat until all attached branches close.
    const includedBranchIds = new Set<string>()
    let changed = true
    while (changed) {
      changed = false
      for (const branch of allBranches) {
        if (
          includedBranchIds.has(branch.id) ||
          (!includedPersonIds.has(branch.anchor_person_id) &&
            !allPersons.some(
              (person) =>
                includedPersonIds.has(person.id) &&
                person.family_branch_id === branch.id
            ))
        )
          continue
        includedBranchIds.add(branch.id)
        changed = true
        includedPersonIds.add(branch.anchor_person_id)
        if (branch.partner_person_id)
          includedPersonIds.add(branch.partner_person_id)
        if (branch.root_person_id) includedPersonIds.add(branch.root_person_id)
        for (const member of allBranchMembers) {
          if (member.branch_id === branch.id)
            includedPersonIds.add(member.person_id)
        }
        for (const person of allPersons) {
          if (person.family_branch_id === branch.id)
            includedPersonIds.add(person.id)
        }
      }
    }
    exportBranches = allBranches.filter((b) => includedBranchIds.has(b.id))
    exportBranchMembers = allBranchMembers.filter((m) =>
      includedBranchIds.has(m.branch_id)
    )

    // 3. Filter the payload
    exportPersons = exportPersons.filter((p) => includedPersonIds.has(p.id))
    exportRels = exportRels.filter(
      (r) =>
        includedPersonIds.has(r.person_a) &&
        includedPersonIds.has(r.person_b) &&
        (!r.family_branch_id || includedBranchIds.has(r.family_branch_id))
    )
    exportPrivateDetails = exportPrivateDetails.filter((d) =>
      includedPersonIds.has(d.person_id)
    )
    // custom_events are not person-scoped, so export all when subtree is selected
  }

  return {
    version: 4,
    timestamp: new Date().toISOString(),
    persons: exportPersons,
    relationships: exportRels,
    person_details_private: exportPrivateDetails,
    custom_events: exportCustomEvents,
    family_branches: exportBranches,
    family_branch_members: exportBranchMembers
  }
}

// ─── Import ───────────────────────────────────────────────────────────────────

export async function importData(
  importPayload:
    | BackupPayload
    | {
        persons: PersonExport[]
        relationships: Relationship[]
        person_details_private?: PersonDetailsPrivateExport[]
        custom_events?: CustomEventExport[]
        family_branches?: FamilyBranchExport[]
        family_branch_members?: FamilyBranchMemberExport[]
      }
) {
  const { t } = await getServerTranslations()
  const isAdmin = await getIsAdmin()
  if (!isAdmin) {
    return { error: t('dataAccessDenied') }
  }

  const supabase = await getSupabase()

  const validationError = validateImportPayload(importPayload, t)
  if (validationError) return { error: validationError }

  const persons = importPayload.persons.map(sanitizePerson)
  const relationships = importPayload.relationships.map(sanitizeRelationship)
  const privateDetails = importPayload.person_details_private ?? []
  const customEvents = (importPayload.custom_events ?? []).map(
    sanitizeCustomEvent
  )
  const branches = (importPayload.family_branches ?? []).map((branch) => ({
    id: branch.id,
    name: branch.name,
    anchor_person_id: branch.anchor_person_id,
    partner_person_id: branch.partner_person_id ?? null,
    root_person_id: branch.root_person_id ?? null
  }))
  const branchMembers = (importPayload.family_branch_members ?? []).map(
    (member) => ({
      branch_id: member.branch_id,
      person_id: member.person_id,
      generation: member.generation ?? null
    })
  )
  const { error } = await supabase.rpc('import_family_backup', {
    payload: {
      persons,
      relationships,
      person_details_private: privateDetails,
      custom_events: customEvents,
      family_branches: branches,
      family_branch_members: branchMembers
    }
  })
  if (error) {
    console.error('Atomic backup import failed:', error)
    return { error: t('invalidData') }
  }

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/members')
  revalidatePath('/dashboard/data')

  return {
    success: true,
    imported: {
      persons: persons.length,
      relationships: relationships.length,
      person_details_private: privateDetails.length,
      custom_events: customEvents.length
    }
  }
}
