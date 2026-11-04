import { CalendarDays, MapPin } from 'lucide-react'

import PhotoGallery from '@/components/media/PhotoGallery'
import { contentText } from '@/lib/i18n/content'
import type { ContentInput, ContentImage as ImageRecord } from '@/types/content'
import { contentImageUrl, formatContentDate } from '@/utils/content'

import ContentImage from './ContentImage'

export function PlainContent({ text }: { text: string }) {
  return (
    <div className='space-y-4 text-sm leading-relaxed text-secondary'>
      {text
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((p, i) => (
          <p key={i} className='break-words whitespace-pre-wrap'>
            {p}
          </p>
        ))}
    </div>
  )
}

export default function ContentBody({
  entry,
  images = [],
  locale
}: {
  entry: ContentInput
  images?: ImageRecord[]
  locale: string
}) {
  const t = contentText(locale)
  return (
    <article className='space-y-6'>
      <header className='space-y-3'>
        <div className='flex flex-wrap items-center gap-2 text-sm text-secondary'>
          <span>{t[entry.kind]}</span>
          {entry.visibility === 'internal' && (
            <span className='rounded-full border border-border px-3 py-1'>
              {t.internal}
            </span>
          )}
          {entry.is_featured && (
            <span className='text-tertiary'>{t.pinned}</span>
          )}
        </div>
        <h1 className='font-serif text-3xl font-semibold break-words text-primary sm:text-4xl'>
          {entry.title}
        </h1>
        {entry.summary && (
          <p className='max-w-3xl text-sm leading-relaxed text-secondary'>
            {entry.summary}
          </p>
        )}
      </header>
      {entry.kind === 'announcement' && entry.event_start && (
        <section
          aria-label={t.details}
          className='space-y-3 rounded-xl border border-border bg-neutral p-6 text-sm text-secondary'>
          <p className='flex items-start gap-3'>
            <CalendarDays className='size-5 shrink-0 text-tertiary' />
            <span>
              {formatContentDate(entry.event_start, locale, true)}
              {entry.event_end &&
                ` — ${formatContentDate(entry.event_end, locale, true)}`}
            </span>
          </p>
          {entry.location && (
            <p className='flex items-start gap-3'>
              <MapPin className='size-5 shrink-0 text-tertiary' />
              <span>{entry.location}</span>
            </p>
          )}
        </section>
      )}
      {entry.kind !== 'album' && images[0] && (
        <figure className='space-y-2'>
          <ContentImage
            image={images[0]}
            eager
            className='max-h-[640px] w-full rounded-xl object-contain'
          />
          {images[0].caption && (
            <figcaption className='text-sm text-secondary'>
              {images[0].caption}
            </figcaption>
          )}
        </figure>
      )}
      <PlainContent text={entry.body} />
      <PhotoGallery
        locale={locale}
        className={
          entry.kind === 'album'
            ? 'columns-1 gap-6 space-y-6 sm:columns-2 lg:columns-3'
            : 'space-y-6'
        }>
        {(entry.kind === 'album' ? images : images.slice(1)).map((image) => (
          <figure key={image.id} className='mb-6 break-inside-avoid space-y-2'>
            <a
              href={contentImageUrl(image.id)}
              data-photo-view
              data-caption={image.caption || image.alt}
              aria-label={image.alt}>
              <ContentImage
                image={image}
                className='w-full rounded-xl object-contain'
              />
            </a>
            {image.caption && (
              <figcaption className='text-sm text-secondary'>
                {image.caption}
              </figcaption>
            )}
          </figure>
        ))}
      </PhotoGallery>
    </article>
  )
}
