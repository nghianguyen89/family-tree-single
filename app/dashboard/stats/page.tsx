import FamilyStats from '@/components/FamilyStats'
import { getServerTranslations } from '@/lib/i18n/server'
import { mainFamilyScope } from '@/utils/familyBranches'
import { fetchAllRows } from '@/utils/supabase/fetchAll'
import { getSupabase } from '@/utils/supabase/queries'

export async function generateMetadata() {
  const { t } = await getServerTranslations()

  return { title: t('statsPageTitle') }
}

export default async function StatsPage() {
  const { t } = await getServerTranslations()
  const supabase = await getSupabase()

  const [{ data: allPersons }, { data: allRelationships }] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase.from('persons').select('*').order('id').range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase.from('relationships').select('*').order('id').range(from, to)
    )
  ])

  const { persons, relationships } = mainFamilyScope(
    allPersons || [],
    allRelationships || []
  )

  return (
    <div className='relative flex w-full flex-1 flex-col pb-12'>
      <div className='relative z-20 mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8'>
        <h1 className='title'>{t('statsPageTitle')}</h1>
        <p className='mt-1 text-sm text-stone-500'>
          {t('statsPageDescription')}
        </p>
      </div>

      <main className='mx-auto w-full max-w-5xl flex-1 px-4 sm:px-6 lg:px-8'>
        <FamilyStats
          persons={persons ?? []}
          relationships={relationships ?? []}
        />
      </main>
    </div>
  )
}
