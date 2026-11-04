import config from '@/app/config'
import MediaLibrary from '@/components/media/MediaLibrary'
import { getServerTranslations } from '@/lib/i18n/server'
import type { MediaAsset } from '@/types/media'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

export async function generateMetadata() {
  const { t } = await getServerTranslations()
  return {
    title: `${t('galleryTitle')} | ${config.siteName}`,
    description: t('galleryDescription')
  }
}

export default async function GalleryPage() {
  const supabase = await getSupabase()
  const profile = await getProfile()

  const { data, count, error } = await supabase
    .from('media_assets')
    .select(
      'id,title,description,event_date,width,height,library_visible,created_at,created_by',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .order('id')
    .range(0, 35)

  return (
    <main className='mx-auto flex w-full max-w-7xl flex-1 flex-col p-4 sm:p-8'>
      <MediaLibrary
        initialAssets={(data || []) as MediaAsset[]}
        count={count || 0}
        editable={
          !!profile?.is_active && ['admin', 'editor'].includes(profile.role)
        }
        error={!!error}
      />
    </main>
  )
}
