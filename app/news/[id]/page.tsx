import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import ContentBody from '@/components/content/ContentBody'
import { contentText } from '@/lib/i18n/content'
import { getServerLocale } from '@/lib/i18n/server'
import { CONTENT_UUID } from '@/utils/content'
import { getContentEntry, getContentImages } from '@/utils/supabase/content'

export async function generateMetadata({
  params
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  if (!CONTENT_UUID.test(id)) return { robots: { index: false, follow: false } }
  const entry = await getContentEntry(id)
  return entry
    ? {
        title: entry.title,
        description: entry.summary,
        robots: {
          index: entry.visibility === 'public',
          follow: entry.visibility === 'public'
        }
      }
    : { robots: { index: false, follow: false } }
}
export default async function ContentPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!CONTENT_UUID.test(id)) notFound()
  const entry = await getContentEntry(id)
  if (!entry) notFound()
  const [{ images }, locale] = await Promise.all([
    getContentImages(id),
    getServerLocale()
  ])
  const t = contentText(locale)
  return (
    <main className='mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6'>
      <Link
        href='/news'
        className='inline-flex text-sm text-secondary hover:text-primary'>
        ← {t.archive}
      </Link>
      <div className='rounded-3xl border border-border bg-surface p-6 sm:p-8'>
        <ContentBody entry={entry} images={images} locale={locale} />
      </div>
    </main>
  )
}
