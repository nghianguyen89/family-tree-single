import type { Metadata } from 'next'
import Link from 'next/link'

import { contentText } from '@/lib/i18n/content'
import { getServerLocale } from '@/lib/i18n/server'
import { requireContentEditor } from '@/utils/supabase/content-editor'

export const metadata: Metadata = { robots: { index: false, follow: false } }
export default async function ContentLayout({
  children
}: {
  children: React.ReactNode
}) {
  await requireContentEditor()
  const t = contentText(await getServerLocale())
  return (
    <main className='mx-auto w-full max-w-7xl space-y-6 px-4 py-8 text-sm sm:px-6 lg:px-8'>
      <div className='flex flex-wrap items-center justify-between gap-4'>
        <h1 className='font-serif text-3xl font-semibold'>{t.manage}</h1>
        <Link href='/' className='btn-outline'>
          {t.openHome}
        </Link>
      </div>
      <nav className='flex flex-wrap gap-3' aria-label={t.manage}>
        <Link href='/dashboard/content' className='btn-outline'>
          {t.contents}
        </Link>
        <Link href='/dashboard/content/settings' className='btn-outline'>
          {t.settings}
        </Link>
        <Link href='/dashboard/content?trash=1' className='btn-outline'>
          {t.trash}
        </Link>
        <Link href='/dashboard/content/new' className='btn-primary'>
          {t.create}
        </Link>
      </nav>
      {children}
    </main>
  )
}
