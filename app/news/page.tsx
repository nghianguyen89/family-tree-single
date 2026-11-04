import Link from 'next/link'

import ContentCard from '@/components/content/ContentCard'
import { contentText } from '@/lib/i18n/content'
import { getServerLocale } from '@/lib/i18n/server'
import type { ContentKind } from '@/types/content'
import { CONTENT_KINDS } from '@/utils/content'
import { getContentFeed, getEntryCover } from '@/utils/supabase/content'

export default async function NewsPage({
  searchParams
}: {
  searchParams: Promise<{ kind?: string; page?: string }>
}) {
  const params = await searchParams,
    locale = await getServerLocale(),
    t = contentText(locale)
  const kind = CONTENT_KINDS.includes(params.kind as ContentKind)
    ? (params.kind as ContentKind)
    : undefined
  const page = Math.min(10000, Math.max(0, Number(params.page) || 0)) | 0
  const feed = await getContentFeed(kind, page)
  const covers = new Map(
    await Promise.all(
      feed.entries.map(async (e) => [e.id, await getEntryCover(e.id)] as const)
    )
  )
  const link = (n: number) => `/news?page=${n}${kind ? `&kind=${kind}` : ''}`
  return (
    <main className='mx-auto w-full max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8'>
      <h1 className='font-serif text-3xl font-semibold'>{t.archive}</h1>
      <nav aria-label={t.kind} className='flex flex-wrap gap-3'>
        {[undefined, ...CONTENT_KINDS].map((k) => (
          <Link
            key={k || 'all'}
            href={k ? `/news?kind=${k}` : '/news'}
            aria-current={k === kind ? 'page' : undefined}
            className={`rounded-full border px-4 py-2 text-sm ${k === kind ? 'border-primary bg-primary text-surface' : 'border-border bg-surface text-secondary'}`}>
            {k ? t[k] : t.every}
          </Link>
        ))}
      </nav>
      {feed.entries.length ? (
        <div className='grid gap-6 md:grid-cols-2 lg:grid-cols-3'>
          {feed.entries.map((entry) => (
            <ContentCard
              key={entry.id}
              entry={entry}
              image={covers.get(entry.id) || null}
              locale={locale}
            />
          ))}
        </div>
      ) : (
        <p role='status' className='text-sm text-secondary'>
          {feed.error ? t.unavailable : t.noResults}
        </p>
      )}
      <nav className='flex justify-between gap-4' aria-label={t.archive}>
        {page > 0 ? (
          <Link href={link(page - 1)} className='btn-outline'>
            {t.previous}
          </Link>
        ) : (
          <span />
        )}
        {(page + 1) * 12 < feed.count && (
          <Link href={link(page + 1)} className='btn-outline'>
            {t.next}
          </Link>
        )}
      </nav>
    </main>
  )
}
