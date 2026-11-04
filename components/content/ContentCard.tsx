import { ArrowUpRight, CalendarDays, ImageIcon, MapPin } from 'lucide-react'
import Link from 'next/link'

import { categoryText, contentText } from '@/lib/i18n/content'
import type { ContentEntry, ContentImage as ImageRecord } from '@/types/content'
import { formatContentDate } from '@/utils/content'

import ContentImage from './ContentImage'

export default function ContentCard({
  entry,
  image,
  locale
}: {
  entry: ContentEntry
  image: ImageRecord | null
  locale: string
}) {
  const t = contentText(locale)
  return (
    <Link
      href={`/news/${entry.id}`}
      className='group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-tertiary'>
      {entry.kind !== 'announcement' &&
        (image ? (
          <ContentImage
            image={image}
            className={
              entry.kind === 'album'
                ? 'h-auto w-full'
                : 'aspect-[4/3] w-full object-cover'
            }
          />
        ) : (
          <div className='flex aspect-[4/3] items-center justify-center bg-neutral text-secondary'>
            <ImageIcon className='size-8' aria-hidden='true' />
          </div>
        ))}
      <div className='flex flex-1 flex-col gap-3 p-6'>
        <div className='flex flex-wrap items-center gap-2 text-sm text-secondary'>
          <span>
            {entry.kind === 'article'
              ? categoryText(entry.category, locale)
              : t[entry.kind]}
          </span>
          {entry.is_featured && (
            <span className='text-tertiary'>{t.pinned}</span>
          )}
          {entry.visibility === 'internal' && (
            <span className='rounded-full border border-border px-2 py-1'>
              {t.internal}
            </span>
          )}
        </div>
        <h3 className='font-serif text-xl font-semibold break-words text-primary'>
          {entry.title}
        </h3>
        {entry.kind === 'announcement' && entry.event_start && (
          <p className='flex items-start gap-2 text-sm text-secondary'>
            <CalendarDays className='mt-1 size-4 shrink-0 text-tertiary' />
            <span>{formatContentDate(entry.event_start, locale, true)}</span>
          </p>
        )}
        {entry.kind === 'announcement' && entry.location && (
          <p className='flex items-start gap-2 text-sm text-secondary'>
            <MapPin className='size-4 shrink-0' />
            <span>{entry.location}</span>
          </p>
        )}
        {entry.summary && (
          <p className='line-clamp-3 text-sm leading-relaxed text-secondary'>
            {entry.summary}
          </p>
        )}
        <div className='mt-auto flex items-center justify-between gap-3 pt-3 text-sm text-secondary'>
          <span>
            {entry.publish_at && formatContentDate(entry.publish_at, locale)}
          </span>
          <ArrowUpRight
            className='size-4 text-tertiary transition-transform group-hover:translate-x-1'
            aria-hidden='true'
          />
        </div>
      </div>
    </Link>
  )
}
