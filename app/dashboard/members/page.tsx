import MembersViews from '@/components/MembersViews'
import MemberDetailModal from '@/components/modal/MemberDetailModal'
import ViewToggle, { ViewMode } from '@/components/ViewToggle'
import { MemberListProvider } from '@/context/MemberListContext'
import type { FamilyBranch } from '@/types/branches'
import { mainFamilyScope } from '@/utils/familyBranches'
import { fetchAllRows } from '@/utils/supabase/fetchAll'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

interface PageProps {
  searchParams: Promise<{ view?: string; rootId?: string; avatar?: string }>
}
export default async function FamilyTreePage({ searchParams }: PageProps) {
  const { view, rootId, avatar } = await searchParams
  const initialView = view as ViewMode | undefined
  const initialShowAvatar = avatar !== 'hide'

  const profile = await getProfile()
  const canEdit =
    profile?.is_active === true &&
    (profile.role === 'admin' || profile.role === 'editor')

  // If view is list, we only need persons, not relationships.
  // We fetch persons for all views to pass down as a prop if we want, or let components fetch.
  // Actually, to make transitions fast and avoid duplicate fetching across components,
  // we will fetch data here and pass it down as props.
  const supabase = await getSupabase()

  const [personsRes, relsRes, branchesRes] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from('persons')
        .select('*')
        .order('birth_year', { ascending: true, nullsFirst: false })
        .order('id')
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase.from('relationships').select('*').order('id').range(from, to)
    ),
    fetchAllRows<FamilyBranch>((from, to) =>
      supabase
        .from('family_branches')
        .select(
          'id,name,anchor_person_id,partner_person_id,root_person_id,created_at,updated_at'
        )
        .order('id')
        .range(from, to)
    )
  ])

  const { persons, relationships } = mainFamilyScope(
    personsRes.data || [],
    relsRes.data || []
  )

  // Prepare map and roots for tree views
  const personsMap = new Map()
  persons.forEach((p) => personsMap.set(p.id, p))

  const childIds = new Set(
    relationships
      .filter(
        (r) => r.type === 'biological_child' || r.type === 'adopted_child'
      )
      .map((r) => r.person_b)
  )

  let finalRootId = rootId

  // If no rootId is provided, fallback to the earliest created person
  if (!finalRootId || !personsMap.has(finalRootId)) {
    const rootsFallback = persons.filter((p) => !childIds.has(p.id))
    if (rootsFallback.length > 0) {
      finalRootId = rootsFallback[0].id
    } else if (persons.length > 0) {
      finalRootId = persons[0].id // ultimate fallback
    }
  }

  return (
    <MemberListProvider
      branches={branchesRes.error ? [] : branchesRes.data}
      initialView={initialView}
      initialRootId={finalRootId}
      initialShowAvatar={initialShowAvatar}>
      <ViewToggle />
      <MembersViews
        persons={persons}
        relationships={relationships}
        canEdit={canEdit}
      />

      <MemberDetailModal />
    </MemberListProvider>
  )
}
