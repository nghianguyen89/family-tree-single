'use server'

import { randomUUID } from 'node:crypto'

import { revalidatePath } from 'next/cache'

import type { Person, Relationship } from '@/types'
import type {
  BranchPersonOption,
  BranchPersonPayload,
  BranchRelation,
  FamilyBranch,
  FamilyBranchMember
} from '@/types/branches'
import { branchTreePreview } from '@/utils/familyBranches'
import { UUID, validateIntake } from '@/utils/intake'
import { fetchAllRows, fetchInChunks } from '@/utils/supabase/fetchAll'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

const migrationCodes = new Set([
  'PGRST205',
  'PGRST204',
  'PGRST202',
  '42703',
  '42883',
  '42P01'
])
function dbError(error: { code?: string; message: string }) {
  return migrationCodes.has(error.code || '') ? 'migration' : error.message
}

async function activeClient(edit = false) {
  const profile = await getProfile()
  if (
    !profile?.is_active ||
    (edit && !['admin', 'editor'].includes(profile.role))
  )
    return null
  return getSupabase()
}

export async function getPersonBranches(personId: string) {
  const profile = await getProfile()
  const canCreate = profile?.is_active === true && profile.role === 'admin'
  const supabase = await activeClient()
  if (!supabase) return { branches: [] as FamilyBranch[], error: 'permission' }
  if (!UUID.test(personId))
    return { branches: [] as FamilyBranch[], error: 'invalid' }
  const memberships = await fetchAllRows<{ branch_id: string }>((from, to) =>
    supabase
      .from('family_branch_members')
      .select('branch_id')
      .eq('person_id', personId)
      .order('branch_id')
      .range(from, to)
  )
  if (memberships.error)
    return { branches: [] as FamilyBranch[], error: dbError(memberships.error) }
  const ids = (memberships.data || []).map((row) => row.branch_id)
  const branches = await fetchInChunks<string, FamilyBranch>(ids, (chunk) =>
    supabase
      .from('family_branches')
      .select(
        'id,name,anchor_person_id,partner_person_id,root_person_id,created_at,updated_at'
      )
      .in('id', chunk)
      .order('name')
      .order('id')
  )
  if (branches.error)
    return { branches: [] as FamilyBranch[], error: dbError(branches.error) }
  const coupleBranches = await fetchAllRows<FamilyBranch>((from, to) =>
    supabase
      .from('family_branches')
      .select(
        'id,name,anchor_person_id,partner_person_id,root_person_id,created_at,updated_at'
      )
      .or(`anchor_person_id.eq.${personId},partner_person_id.eq.${personId}`)
      .order('id')
      .range(from, to)
  )
  if (coupleBranches.error)
    return {
      branches: [] as FamilyBranch[],
      error: dbError(coupleBranches.error),
      canCreate: false
    }
  const unique = new Map(
    [...branches.data, ...coupleBranches.data].map((branch) => [
      branch.id,
      branch
    ])
  )
  const editable = await Promise.all(
    Array.from(unique.keys()).map(async (branchId) => {
      const permission = await supabase.rpc('can_edit_family_branch', {
        p_branch_id: branchId
      })
      return !permission.error && permission.data === true ? branchId : null
    })
  )
  return {
    branches: Array.from(unique.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
    error: null,
    canCreate,
    editableBranchIds: editable.filter((id): id is string => id !== null)
  }
}

export async function createBranch(anchorPersonId: string, name: string) {
  const profile = await getProfile()
  if (profile?.role !== 'admin' || !profile.is_active)
    return { error: 'permission' }
  const supabase = await activeClient(true)
  if (!supabase) return { error: 'permission' }
  if (!UUID.test(anchorPersonId) || !name.trim() || name.trim().length > 150)
    return { error: 'invalid' }
  const result = await supabase.rpc('create_family_branch', {
    p_anchor_person_id: anchorPersonId,
    p_name: name.trim()
  })
  if (result.error) return { error: dbError(result.error) }
  revalidatePath('/dashboard', 'layout')
  return { id: result.data as string }
}

export async function updateBranch(
  branchId: string,
  changes: {
    name?: string
    root_person_id?: string
    partner_person_id?: string | null
  }
) {
  const supabase = await activeClient(true)
  if (!supabase) return { error: 'permission' }
  if (
    !UUID.test(branchId) ||
    !changes ||
    Object.keys(changes).some(
      (key) => !['name', 'root_person_id', 'partner_person_id'].includes(key)
    )
  )
    return { error: 'invalid' }
  const update: {
    name?: string
    root_person_id?: string
    partner_person_id?: string | null
  } = {}
  if ('partner_person_id' in changes) {
    const profile = await getProfile()
    if (profile?.role !== 'admin' || !profile.is_active)
      return { error: 'permission' }
    if (
      changes.partner_person_id !== null &&
      (typeof changes.partner_person_id !== 'string' ||
        !UUID.test(changes.partner_person_id))
    )
      return { error: 'invalid' }
    update.partner_person_id = changes.partner_person_id
  }
  if (changes.name !== undefined) {
    if (
      typeof changes.name !== 'string' ||
      !changes.name.trim() ||
      changes.name.trim().length > 150
    )
      return { error: 'invalid' }
    update.name = changes.name.trim()
  }
  if (changes.root_person_id !== undefined) {
    if (!UUID.test(changes.root_person_id)) return { error: 'invalid' }
    const member = await supabase
      .from('family_branch_members')
      .select('person_id')
      .eq('branch_id', branchId)
      .eq('person_id', changes.root_person_id)
      .maybeSingle()
    if (member.error) return { error: dbError(member.error) }
    if (!member.data) return { error: 'invalid' }
    update.root_person_id = changes.root_person_id
  }
  if (!Object.keys(update).length) return { error: 'invalid' }
  const result = await supabase
    .from('family_branches')
    .update(update)
    .eq('id', branchId)
    .select('id')
    .single()
  if (result.error) return { error: dbError(result.error) }
  revalidatePath(`/dashboard/branches/${branchId}`)
  return { success: true }
}

export async function searchBranchPeople(branchId: string, query: string) {
  const supabase = await activeClient()
  if (!supabase)
    return { people: [] as BranchPersonOption[], error: 'permission' }
  if (
    !UUID.test(branchId) ||
    typeof query !== 'string' ||
    query.trim().length < 2 ||
    query.length > 100
  )
    return { people: [] as BranchPersonOption[], error: 'invalid' }
  const safeQuery = query
    .trim()
    .replace(/[,%_()]/g, ' ')
    .trim()
  if (safeQuery.length < 2)
    return { people: [] as BranchPersonOption[], error: 'invalid' }
  const access = await supabase
    .from('family_branches')
    .select('id')
    .eq('id', branchId)
    .maybeSingle()
  if (access.error || !access.data)
    return { people: [] as BranchPersonOption[], error: 'permission' }
  const result = await supabase
    .from('persons')
    .select('id,full_name,birth_year')
    .ilike('full_name', `%${safeQuery}%`)
    .order('full_name')
    .limit(20)
  if (result.error)
    return { people: [] as BranchPersonOption[], error: dbError(result.error) }
  return { people: (result.data || []) as BranchPersonOption[], error: null }
}

export async function getBranchRelationshipPeople(branchId: string) {
  const supabase = await activeClient(true)
  if (!supabase)
    return { people: [] as BranchPersonOption[], error: 'permission' }
  if (!UUID.test(branchId))
    return { people: [] as BranchPersonOption[], error: 'invalid' }
  const branch = await supabase
    .from('family_branches')
    .select('id')
    .eq('id', branchId)
    .maybeSingle()
  if (branch.error)
    return { people: [] as BranchPersonOption[], error: dbError(branch.error) }
  if (!branch.data)
    return { people: [] as BranchPersonOption[], error: 'permission' }
  const memberships = await fetchAllRows<{ person_id: string }>((from, to) =>
    supabase
      .from('family_branch_members')
      .select('person_id')
      .eq('branch_id', branchId)
      .order('person_id')
      .range(from, to)
  )
  if (memberships.error)
    return {
      people: [] as BranchPersonOption[],
      error: dbError(memberships.error)
    }
  const people = await fetchInChunks<string, BranchPersonOption>(
    memberships.data.map((member) => member.person_id),
    (ids) =>
      supabase
        .from('persons')
        .select('id,full_name,birth_year')
        .in('id', ids)
        .order('full_name')
        .order('id')
  )
  return {
    people: people.data,
    error: people.error ? dbError(people.error) : null
  }
}

export async function addBranchPerson(input: {
  branchId: string
  payload?: BranchPersonPayload
  relativeId?: string | null
  relation: BranchRelation
  existingPersonId?: string | null
}) {
  const supabase = await activeClient(true)
  if (!supabase) return { error: 'permission' }
  if (
    !input ||
    !UUID.test(input.branchId) ||
    !['member', 'parent', 'child', 'spouse'].includes(input.relation) ||
    (input.relativeId != null && !UUID.test(input.relativeId)) ||
    (input.existingPersonId != null && !UUID.test(input.existingPersonId)) ||
    (input.relation !== 'member' && !input.relativeId)
  )
    return { error: 'invalid' }
  if (!input.existingPersonId) {
    const payload = input.payload
    if (
      !payload ||
      !validateIntake({
        anchor_id: input.branchId,
        sender_name: 'branch',
        sender_contact: 'branch',
        note: '',
        people: [
          {
            client_id: randomUUID(),
            relation: 'child',
            relative_to: 'anchor',
            data: payload
          }
        ]
      })
    )
      return { error: 'invalid' }
  }
  const result = await supabase.rpc('add_family_branch_person', {
    p_branch_id: input.branchId,
    p_payload: input.existingPersonId ? {} : input.payload,
    p_relative_id: input.relativeId || null,
    p_relation: input.relation,
    p_existing_person_id: input.existingPersonId || null
  })
  if (result.error) return { error: dbError(result.error) }
  revalidatePath(`/dashboard/branches/${input.branchId}`)
  revalidatePath('/dashboard/members')
  return { id: result.data as string }
}

export async function updateBranchMemberGeneration(
  branchId: string,
  personId: string,
  generation: number | null
) {
  const supabase = await activeClient(true)
  if (!supabase) return { error: 'permission' }
  if (
    !UUID.test(branchId) ||
    !UUID.test(personId) ||
    (generation !== null &&
      (!Number.isInteger(generation) || generation < 1 || generation > 10000))
  )
    return { error: 'invalid' }
  const result = await supabase
    .from('family_branch_members')
    .update({ generation })
    .eq('branch_id', branchId)
    .eq('person_id', personId)
    .select('person_id')
    .single()
  if (result.error) return { error: dbError(result.error) }
  revalidatePath(`/dashboard/branches/${branchId}`)
  return { success: true }
}

export async function removeBranchRelationship(
  branchId: string,
  relationshipId: string
) {
  const supabase = await activeClient(true)
  if (!supabase) return { error: 'permission' }
  if (!UUID.test(branchId) || !UUID.test(relationshipId))
    return { error: 'invalid' }
  const result = await supabase
    .from('relationships')
    .delete()
    .eq('id', relationshipId)
    .eq('family_branch_id', branchId)
    .select('id')
    .single()
  if (result.error) return { error: dbError(result.error) }
  revalidatePath(`/dashboard/branches/${branchId}`)
  return { success: true }
}

export async function getBranchTreePreview(branchId: string) {
  const supabase = await activeClient()
  if (!supabase) return { preview: null, error: 'permission' }
  if (!UUID.test(branchId)) return { preview: null, error: 'invalid' }
  // Check branch RLS before loading any membership or private profiles.
  const branch = await supabase
    .from('family_branches')
    .select(
      'id,name,anchor_person_id,partner_person_id,root_person_id,created_at,updated_at'
    )
    .eq('id', branchId)
    .maybeSingle()
  if (branch.error) return { preview: null, error: dbError(branch.error) }
  if (!branch.data) return { preview: null, error: 'permission' }
  const members = await fetchAllRows<FamilyBranchMember>((from, to) =>
    supabase
      .from('family_branch_members')
      .select('branch_id,person_id,generation')
      .eq('branch_id', branchId)
      .order('person_id')
      .range(from, to)
  )
  if (members.error) return { preview: null, error: dbError(members.error) }
  const ids = members.data.map((m) => m.person_id)
  const [people, relations] = await Promise.all([
    fetchInChunks<string, Person>(ids, (chunk) =>
      supabase.from('persons').select('*').in('id', chunk).order('id')
    ),
    fetchInChunks<string, Relationship>(ids, (chunk) =>
      fetchAllRows<Relationship>((from, to) =>
        supabase
          .from('relationships')
          .select('*')
          .in('person_a', chunk)
          .or(`family_branch_id.is.null,family_branch_id.eq.${branchId}`)
          .order('id')
          .range(from, to)
      )
    )
  ])
  if (people.error || relations.error)
    return { preview: null, error: dbError((people.error || relations.error)!) }
  return {
    preview: branchTreePreview(
      branch.data as FamilyBranch,
      people.data,
      relations.data,
      members.data
    ),
    error: null
  }
}
