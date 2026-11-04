import PublicHeader from '@/components/content/PublicHeader'
import Footer from '@/components/Footer'
import { getServerLocale } from '@/lib/i18n/server'
import { getHomeSettings } from '@/utils/supabase/content'
import { getProfile } from '@/utils/supabase/queries'

export default async function NewsLayout({
  children
}: {
  children: React.ReactNode
}) {
  const [{ settings }, profile, locale] = await Promise.all([
    getHomeSettings(),
    getProfile(),
    getServerLocale()
  ])
  return (
    <div className='flex min-h-screen flex-col bg-neutral text-sm text-primary'>
      <PublicHeader
        title={settings.title}
        locale={locale}
        active={!!profile?.is_active}
        editor={
          !!profile?.is_active && ['admin', 'editor'].includes(profile.role)
        }
      />
      {children}
      <Footer className='mt-auto border-t border-border bg-surface' />
    </div>
  )
}
