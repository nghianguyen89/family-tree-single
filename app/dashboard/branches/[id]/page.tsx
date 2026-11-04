import { redirect } from 'next/navigation'

import BranchWorkspace from '@/components/branches/BranchWorkspace'
import { branchesMessages } from '@/lib/i18n/branches'
import { getServerLocale } from '@/lib/i18n/server'
import type { Person, Relationship } from '@/types'
import type {
  BranchPersonOption,
  FamilyBranch,
  FamilyBranchMember
} from '@/types/branches'
import { branchTreePreview } from '@/utils/familyBranches'
import { UUID } from '@/utils/intake'
import { fetchAllRows, fetchInChunks } from '@/utils/supabase/fetchAll'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

export default async function BranchPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ rootId?: string; view?: string; avatar?: string }>
}) {
  const [{ id }, query, locale, profile] = await Promise.all([
    params,
    searchParams,
    getServerLocale(),
    getProfile()
  ])
  const text = branchesMessages[locale]
  if (!profile?.is_active)
    return (
      <main className='mx-auto max-w-7xl p-6 text-sm'>{text.permission}</main>
    )
  if (!UUID.test(id))
    return (
      <main className='mx-auto max-w-7xl p-6 text-sm'>{text.unavailable}</main>
    )

  const supabase = await getSupabase()
  const branchRes = await supabase
    .from('family_branches')
    .select(
      'id,name,anchor_person_id,partner_person_id,root_person_id,created_at,updated_at'
    )
    .eq('id', id)
    .maybeSingle()
  if (branchRes.error)
    return (
      <main className='mx-auto max-w-7xl p-6 text-sm' role='alert'>
        {text.migration}
      </main>
    )
  if (!branchRes.data)
    return (
      <main className='mx-auto max-w-7xl p-6 text-sm'>{text.unavailable}</main>
    )
  const branch = branchRes.data as FamilyBranch
  const editPermission = await supabase.rpc('can_edit_family_branch', {
    p_branch_id: id
  })
  const canEdit = !editPermission.error && editPermission.data === true

  const membersRes = await fetchAllRows<FamilyBranchMember>((from, to) =>
    supabase
      .from('family_branch_members')
      .select('branch_id,person_id,generation')
      .eq('branch_id', id)
      .order('person_id')
      .range(from, to)
  )
  if (membersRes.error)
    return (
      <main className='mx-auto max-w-7xl p-6 text-sm' role='alert'>
        {text.migration}
      </main>
    )
  const personIds = membersRes.data.map((member) => member.person_id)
  const [personsRes, relationsRes] = await Promise.all([
    fetchInChunks<string, Person>(personIds, (chunk) =>
      supabase.from('persons').select('*').in('id', chunk).order('id')
    ),
    fetchAllRows<Relationship>((from, to) =>
      supabase
        .from('relationships')
        .select('*')
        .or(`family_branch_id.is.null,family_branch_id.eq.${id}`)
        .order('id')
        .range(from, to)
    )
  ])
  if (personsRes.error || relationsRes.error)
    return (
      <main className='mx-auto max-w-7xl p-6 text-sm' role='alert'>
        {text.migration}
      </main>
    )
  const spouseIds = new Set<string>()
  if (profile.role === 'admin')
    for (const relationship of relationsRes.data) {
      if (relationship.family_branch_id || relationship.type !== 'marriage')
        continue
      if (relationship.person_a === branch.anchor_person_id)
        spouseIds.add(relationship.person_b)
      if (relationship.person_b === branch.anchor_person_id)
        spouseIds.add(relationship.person_a)
    }
  const partners = await fetchInChunks<string, BranchPersonOption>(
    Array.from(spouseIds),
    (ids) =>
      supabase
        .from('persons')
        .select('id,full_name,birth_year')
        .is('family_branch_id', null)
        .in('id', ids)
        .order('id')
  )
  if (partners.error)
    return (
      <main role='alert' className='mx-auto max-w-7xl p-6 text-sm'>
        {text.error}
      </main>
    )
  const { persons, relationships } = branchTreePreview(
    branch,
    personsRes.data,
    relationsRes.data,
    membersRes.data
  )
  const visibleIds = new Set(persons.map((person) => person.id))
  const defaultRoot =
    branch.root_person_id && visibleIds.has(branch.root_person_id)
      ? branch.root_person_id
      : branch.anchor_person_id
  if (!query.rootId && defaultRoot && visibleIds.has(defaultRoot))
    redirect(
      `/dashboard/branches/${id}?rootId=${defaultRoot}${query.view ? `&view=${encodeURIComponent(query.view)}` : ''}${query.avatar ? `&avatar=${encodeURIComponent(query.avatar)}` : ''}`
    )

  return (
    <BranchWorkspace
      branch={branch}
      persons={persons}
      relationships={relationships}
      members={membersRes.data}
      canEdit={canEdit}
      isAdmin={profile.role === 'admin'}
      partnerOptions={partners.data}
      initialRootId={
        query.rootId && visibleIds.has(query.rootId)
          ? query.rootId
          : defaultRoot
      }
      initialView={query.view}
      initialShowAvatar={query.avatar !== 'hide'}
    />
  )
}
