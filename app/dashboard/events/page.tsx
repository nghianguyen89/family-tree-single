import EventsList from '@/components/EventsList'
import MemberDetailModal from '@/components/modal/MemberDetailModal'
import { MemberListProvider } from '@/context/MemberListContext'
import { getServerLocale, getServerTranslations } from '@/lib/i18n/server'
import { fetchAllRows } from '@/utils/supabase/fetchAll'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

export async function generateMetadata() {
  const { t } = await getServerTranslations()
  return { title: t('eventsTitle') }
}

export default async function EventsPage({
  searchParams
}: {
  searchParams: Promise<{ branchId?: string }>
}) {
  const { t } = await getServerTranslations()
  const locale = await getServerLocale()
  const { branchId } = await searchParams
  const supabase = await getSupabase()
  const profile = await getProfile()

  const [personsRes, customEventsRes, branchesRes, membersRes] =
    await Promise.all([
      fetchAllRows((from, to) =>
        supabase.from('persons').select('*').order('id').range(from, to)
      ),
      fetchAllRows((from, to) =>
        supabase
          .from('custom_events')
          .select('id, name, content, event_date, location, created_by')
          .order('id')
          .range(from, to)
      ),
      fetchAllRows<{ id: string; name: string }>((from, to) =>
        supabase
          .from('family_branches')
          .select('id,name')
          .order('id')
          .range(from, to)
      ),
      fetchAllRows<{ branch_id: string; person_id: string }>((from, to) =>
        supabase
          .from('family_branch_members')
          .select('branch_id,person_id')
          .order('branch_id')
          .order('person_id')
          .range(from, to)
      )
    ])

  const persons = personsRes.data || []
  const customEvents = customEventsRes.data || []

  return (
    <MemberListProvider>
      <div className='relative flex w-full flex-1 flex-col pb-12'>
        <div className='relative z-20 mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8'>
          <h1 className='title'>{t('eventsTitle')}</h1>
          <p className='mt-1 text-sm text-stone-500'>
            {t('eventsDescription')}
          </p>
        </div>

        <main className='mx-auto w-full max-w-3xl flex-1 px-4 sm:px-6 lg:px-8'>
          {(personsRes.error ||
            customEventsRes.error ||
            branchesRes.error ||
            membersRes.error) && (
            <p
              role='alert'
              className='mb-4 rounded-xl border border-border bg-surface p-4 text-sm text-secondary'>
              {locale === 'vi'
                ? 'Chưa tải được đầy đủ lịch. Nếu chưa nâng cấp, cần chạy migration nhánh phụ 20261019000000_family_branches.sql.'
                : 'The calendar could not be fully loaded. If not upgraded, apply the family branches migration 20261019000000_family_branches.sql.'}
            </p>
          )}
          <EventsList
            readOnly={profile?.is_shared_viewer === true}
            key={branchId || 'all'}
            persons={persons ?? []}
            customEvents={customEvents ?? []}
            branches={branchesRes.data}
            branchMembers={membersRes.data}
            initialBranchId={
              branchId === 'main' ||
              branchesRes.data.some((branch) => branch.id === branchId)
                ? branchId
                : 'all'
            }
          />
        </main>
      </div>

      {/* Modal for member details when clicking an event card */}
      <MemberDetailModal />
    </MemberListProvider>
  )
}
