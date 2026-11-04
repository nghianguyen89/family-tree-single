import { ArrowRight, BookOpen, MapPin, Network } from 'lucide-react'
import Link from 'next/link'

import { PlainContent } from '@/components/content/ContentBody'
import ContentCard from '@/components/content/ContentCard'
import ContentImage from '@/components/content/ContentImage'
import PublicHeader from '@/components/content/PublicHeader'
import Footer from '@/components/Footer'
import { contentText } from '@/lib/i18n/content'
import { getServerLocale } from '@/lib/i18n/server'
import type { ContentKind, ContentImage as ImageRecord } from '@/types/content'
import {
  getContentFeed,
  getEntryCover,
  getHomeSettings
} from '@/utils/supabase/content'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

export default async function HomePageView() {
  const locale = await getServerLocale(),
    t = contentText(locale)
  const [{ settings }, profile, notices, articles, albums] = await Promise.all([
    getHomeSettings(),
    getProfile(),
    getContentFeed('announcement', 0, 3, true),
    getContentFeed('article', 0, 3, true),
    getContentFeed('album', 0, 3, true)
  ])
  const editor =
    !!profile?.is_active && ['admin', 'editor'].includes(profile.role)
  const db = await getSupabase()
  const { data: cover } = settings.cover_image_id
    ? await db
        .from('home_content_images')
        .select('*')
        .eq('id', settings.cover_image_id)
        .maybeSingle()
    : { data: null }
  const feeds = { announcements: notices, articles, albums }
  const kinds = {
    announcements: 'announcement',
    articles: 'article',
    albums: 'album'
  } as const
  const coverPairs = await Promise.all(
    [...articles.entries, ...albums.entries].map(
      async (e) => [e.id, await getEntryCover(e.id)] as const
    )
  )
  const covers = new Map(coverPairs)
  return (
    <div className='flex min-h-screen flex-col bg-neutral text-sm text-primary'>
      <PublicHeader
        title={settings.title}
        locale={locale}
        active={!!profile?.is_active}
        editor={editor}
      />
      <main>
        <section className='mx-auto grid max-w-7xl items-center gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:gap-12 lg:px-8 lg:py-16'>
          <div className='space-y-6'>
            <p className='flex items-center gap-2 text-sm font-medium text-tertiary'>
              <span className='h-px w-8 bg-tertiary' />
              {t.heritage}
            </p>
            <div className='space-y-4'>
              <h1 className='font-serif text-4xl leading-tight font-semibold break-words sm:text-5xl lg:text-6xl'>
                {settings.title}
              </h1>
              <p className='max-w-xl text-sm leading-relaxed text-secondary'>
                {settings.subtitle}
              </p>
              {(['origin', 'origin_previous'] as const).map(
                (key) =>
                  settings[key] && (
                    <p
                      key={key}
                      className='flex items-start gap-2 text-sm text-secondary'>
                      <MapPin className='mt-1 size-4 shrink-0 text-tertiary' />
                      <span className='min-w-0 break-words whitespace-pre-line'>
                        <span className='block font-medium'>
                          {key === 'origin'
                            ? t.originCurrent
                            : t.originPrevious}
                        </span>
                        {settings[key]}
                      </span>
                    </p>
                  )
              )}
            </div>
            <div className='flex flex-wrap items-center gap-3'>
              <Link href='/dashboard' className='btn-primary'>
                <Network className='size-4' />
                {t.tree}
                <ArrowRight className='size-4' />
              </Link>
              <a href='#family-history' className='btn-outline'>
                {t.history}
              </a>
            </div>
          </div>
          <figure className='overflow-hidden rounded-3xl border border-border bg-surface'>
            {cover ? (
              <ContentImage
                image={cover as ImageRecord}
                eager
                className='aspect-[4/3] w-full object-cover'
              />
            ) : (
              <div className='flex aspect-[4/3] flex-col items-center justify-center gap-6 bg-surface p-8 text-center'>
                <div className='flex size-16 items-center justify-center rounded-full border border-border bg-neutral text-tertiary'>
                  <Network className='size-8' />
                </div>
                <p className='max-w-xs font-serif text-2xl font-semibold text-primary'>
                  {t.noCover}
                </p>
                <span className='h-px w-16 bg-tertiary' />
              </div>
            )}
            {cover?.caption && (
              <figcaption className='px-6 py-4 text-sm text-secondary'>
                {cover.caption}
              </figcaption>
            )}
          </figure>
        </section>
        <section
          id='family-history'
          className='scroll-mt-24 border-y border-border bg-surface'>
          <div className='mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-3 lg:px-8'>
            <div className='space-y-2'>
              <BookOpen className='mb-4 size-6 text-tertiary' />
              <h2 className='font-serif text-2xl font-semibold'>
                {t.discover}
              </h2>
              <p className='text-sm text-secondary'>{t.history}</p>
            </div>
            <div className='lg:col-span-2'>
              {settings.introduction ? (
                <PlainContent text={settings.introduction} />
              ) : (
                <p className='text-sm text-secondary'>{t.empty}</p>
              )}
            </div>
          </div>
        </section>
        <div className='mx-auto max-w-7xl space-y-12 px-4 py-12 sm:px-6 lg:px-8'>
          {settings.section_order.map((section) => {
            const feed = feeds[section],
              kind: ContentKind = kinds[section]
            return (
              <section
                key={section}
                aria-labelledby={`${section}-heading`}
                className='space-y-6'>
                <div className='flex flex-wrap items-end justify-between gap-4'>
                  <div className='space-y-2'>
                    <p className='text-sm text-secondary'>
                      {section === 'albums'
                        ? t.library
                        : t[
                            section === 'announcements'
                              ? 'announcement'
                              : 'article'
                          ]}
                    </p>
                    <h2
                      id={`${section}-heading`}
                      className='font-serif text-3xl font-semibold'>
                      {t[section]}
                    </h2>
                  </div>
                  <Link
                    href={`/news?kind=${kind}`}
                    className='inline-flex items-center gap-2 text-sm font-medium text-secondary hover:text-primary'>
                    {t.all}
                    <ArrowRight className='size-4' />
                  </Link>
                </div>
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
                  <p
                    role={feed.error ? 'status' : undefined}
                    className='rounded-xl border border-border bg-surface p-6 text-sm text-secondary'>
                    {feed.error
                      ? t.unavailable
                      : section === 'announcements'
                        ? t.noEvents
                        : t.empty}
                  </p>
                )}
              </section>
            )
          })}
        </div>
        {settings.contact && (
          <section className='border-t border-border bg-surface'>
            <div className='mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-3 lg:px-8'>
              <h2 className='font-serif text-2xl font-semibold'>{t.contact}</h2>
              <div className='lg:col-span-2'>
                <PlainContent text={settings.contact} />
              </div>
            </div>
          </section>
        )}
      </main>
      <Footer className='mt-auto border-t border-border bg-surface' />
    </div>
  )
}
