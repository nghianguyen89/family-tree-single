import IntakeManager from '@/components/intake/IntakeManager'
import { intakeMessages } from '@/lib/i18n/intake'
import { getServerLocale } from '@/lib/i18n/server'
import { Person } from '@/types'
import { IntakeLink } from '@/types/intake'
import { fetchAllRows } from '@/utils/supabase/fetchAll'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

export default async function IntakePage() {
  const text = intakeMessages[await getServerLocale()]
  const profile = await getProfile()
  if (!profile?.is_active || !['admin', 'editor'].includes(profile.role))
    return (
      <main className='mx-auto w-full max-w-5xl p-6 text-sm'>
        {text.permission}
      </main>
    )
  const supabase = await getSupabase()
  const [people, links] = await Promise.all([
    fetchAllRows<Person>((from, to) =>
      supabase
        .from('persons')
        .select('*')
        .order('full_name')
        .order('id')
        .range(from, to)
    ),
    fetchAllRows<IntakeLink>((from, to) =>
      supabase
        .from('family_intake_links')
        .select(
          'id,title,root_person_id,is_active,expires_at,created_at,share_token'
        )
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to)
    )
  ])
  return (
    <main className='mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6'>
      <h1 className='font-serif text-3xl font-semibold'>{text.title}</h1>
      {people.error || links.error ? (
        <p
          role='alert'
          className='rounded-xl border border-border bg-surface p-4 text-sm text-secondary'>
          {links.error ? text.migration : text.error}
        </p>
      ) : (
        <IntakeManager
          people={people.data.filter((person) => !person.family_branch_id)}
          links={links.data}
        />
      )}
    </main>
  )
}
