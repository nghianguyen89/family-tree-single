import HomeSettingsEditor from '@/components/content/HomeSettingsEditor'
import { contentText } from '@/lib/i18n/content'
import { getServerLocale } from '@/lib/i18n/server'
import type { ContentImage } from '@/types/content'
import { getHomeSettings } from '@/utils/supabase/content'
import { requireContentEditor } from '@/utils/supabase/content-editor'
import { getSupabase } from '@/utils/supabase/queries'

export default async function HomeSettingsPage() {
  await requireContentEditor()
  const { settings, error } = await getHomeSettings(),
    t = contentText(await getServerLocale())
  const db = await getSupabase()
  const { data, error: imageError } = await db
    .from('home_content_images')
    .select('*')
    .is('entry_id', null)
    .order('created_at', { ascending: false })
    .order('id')
    .limit(100)
  if (error || imageError)
    return (
      <p
        role='alert'
        className='rounded-xl border border-border bg-surface p-6 text-sm text-secondary'>
        {t.migration}
      </p>
    )
  return (
    <HomeSettingsEditor
      initial={settings}
      images={(data || []) as ContentImage[]}
    />
  )
}
