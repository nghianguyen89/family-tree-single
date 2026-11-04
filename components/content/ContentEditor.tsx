'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { saveContent } from '@/app/actions/content'
import { categoryText, contentText } from '@/lib/i18n/content'
import { useI18n } from '@/lib/i18n/I18nProvider'
import type {
  ContentEntry,
  ContentImage,
  ContentInput,
  ContentKind
} from '@/types/content'
import {
  CONTENT_CATEGORIES,
  CONTENT_KINDS,
  formatContentDate,
  toContentDate,
  toContentLocal
} from '@/utils/content'

import ContentBody from './ContentBody'
import MediaManager from './MediaManager'

export default function ContentEditor({
  initial,
  kind = 'article',
  images: initialImages = [],
  editorName = null
}: {
  initial?: ContentEntry
  kind?: ContentKind
  images?: ContentImage[]
  editorName?: string | null
}) {
  const { locale } = useI18n(),
    t = contentText(locale),
    router = useRouter()
  const [value, setValue] = useState<ContentInput>(
    initial || {
      kind,
      title: '',
      summary: '',
      body: '',
      category: 'news',
      status: 'draft',
      visibility: 'internal',
      is_featured: false,
      publish_at: null,
      expires_at: null,
      event_start: null,
      event_end: null,
      location: ''
    }
  )
  const [id, setId] = useState(initial?.id || null),
    [revision, setRevision] = useState(initial?.revision || 1)
  const [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [images, setImages] = useState(initialImages)
  const field = <K extends keyof ContentInput>(key: K, v: ContentInput[K]) =>
    setValue((prev) => ({ ...prev, [key]: v }))
  async function save(draft = false) {
    setBusy(true)
    setMessage('')
    const next = {
      ...value,
      status: draft ? ('draft' as const) : value.status,
      publish_at:
        value.publish_at ||
        (value.status === 'published' && !draft
          ? new Date().toISOString()
          : null)
    }
    try {
      const result = await saveContent(next, id, revision)
      if (result.error) {
        setMessage(
          result.error === 'conflict'
            ? t.conflict
            : result.error === 'invalid'
              ? t.invalid
              : t.error
        )
        return
      }
      setId(result.id!)
      setRevision(result.revision!)
      setValue(next)
      setMessage(t.saved)
      if (!id) router.replace(`/dashboard/content/${result.id}`)
    } catch {
      setMessage(t.error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap gap-3'>
        <button
          type='button'
          className='btn-outline'
          aria-pressed={!preview}
          onClick={() => setPreview(false)}>
          {t.edit}
        </button>
        <button
          type='button'
          className='btn-outline'
          aria-pressed={preview}
          onClick={() => setPreview(true)}>
          {t.preview}
        </button>
      </div>
      {initial && (
        <div className='space-y-1 text-sm text-secondary'>
          <p>
            {t.updated}: {formatContentDate(initial.updated_at, locale, true)}
          </p>
          <p className='break-all'>
            {t.by}: {editorName || '—'}
          </p>
        </div>
      )}
      {preview ? (
        <div className='rounded-3xl border border-border bg-surface p-6 sm:p-8'>
          <ContentBody entry={value} images={images} locale={locale} />
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
          className='space-y-6 rounded-3xl border border-border bg-surface p-6 sm:p-8'>
          <div className='grid gap-4 sm:grid-cols-2'>
            <label className='content-field'>
              {t.kind}
              <select
                className='content-control'
                value={value.kind}
                onChange={(e) => field('kind', e.target.value as ContentKind)}>
                {CONTENT_KINDS.map((k) => (
                  <option value={k} key={k}>
                    {t[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className='content-field'>
              {t.category}
              <select
                className='content-control'
                value={value.category}
                onChange={(e) => field('category', e.target.value)}>
                {CONTENT_CATEGORIES.map((k) => (
                  <option value={k} key={k}>
                    {categoryText(k, locale)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className='content-field'>
            {t.title}
            <input
              className='content-control'
              value={value.title}
              onChange={(e) => field('title', e.target.value)}
              required
              maxLength={200}
            />
          </label>
          <label className='content-field'>
            {t.summary}
            <textarea
              className='content-control'
              rows={3}
              value={value.summary}
              onChange={(e) => field('summary', e.target.value)}
              maxLength={600}
            />
          </label>
          <label className='content-field'>
            {t.body}
            <textarea
              className='content-control'
              rows={14}
              value={value.body}
              onChange={(e) => field('body', e.target.value)}
              maxLength={100000}
            />
            <span className='font-normal text-secondary'>{t.bodyHelp}</span>
          </label>
          {value.kind === 'announcement' && (
            <div className='space-y-4 rounded-xl border border-border bg-neutral p-6'>
              <div className='grid gap-4 sm:grid-cols-2'>
                {(['event_start', 'event_end'] as const).map((k) => (
                  <label className='content-field' key={k}>
                    {k === 'event_start' ? t.eventStart : t.eventEnd}
                    <input
                      className='content-control'
                      type='datetime-local'
                      value={toContentLocal(value[k])}
                      onChange={(e) => field(k, toContentDate(e.target.value))}
                    />
                  </label>
                ))}
              </div>
              <label className='content-field'>
                {t.location}
                <input
                  className='content-control'
                  maxLength={500}
                  value={value.location}
                  onChange={(e) => field('location', e.target.value)}
                />
              </label>
            </div>
          )}
          <div className='grid gap-4 sm:grid-cols-2'>
            <label className='content-field'>
              {t.visibility}
              <select
                className='content-control'
                value={value.visibility}
                onChange={(e) =>
                  field(
                    'visibility',
                    e.target.value as ContentInput['visibility']
                  )
                }>
                <option value='internal'>{t.internal}</option>
                <option value='public'>{t.public}</option>
              </select>
            </label>
            <label className='content-field'>
              {t.status}
              <select
                className='content-control'
                value={value.status}
                onChange={(e) =>
                  field('status', e.target.value as ContentInput['status'])
                }>
                <option value='draft'>{t.draft}</option>
                <option value='published'>{t.published}</option>
              </select>
            </label>
            {(['publish_at', 'expires_at'] as const).map((k) => (
              <label className='content-field' key={k}>
                {k === 'publish_at' ? t.publishAt : t.expiresAt}
                <input
                  className='content-control'
                  type='datetime-local'
                  value={toContentLocal(value[k])}
                  onChange={(e) => field(k, toContentDate(e.target.value))}
                />
              </label>
            ))}
          </div>
          <div className='space-y-2 text-sm text-secondary'>
            <p>{t.publicHelp}</p>
            <p>{t.scheduleHelp}</p>
            {value.visibility === 'public' && value.status === 'published' && (
              <p className='font-medium text-tertiary'>{t.setPublic}</p>
            )}
          </div>
          <label className='flex items-center gap-3 text-sm'>
            <input
              className='size-4 accent-tertiary'
              type='checkbox'
              checked={value.is_featured}
              onChange={(e) => field('is_featured', e.target.checked)}
            />
            {t.pinned}
          </label>
          <div className='flex flex-wrap gap-3'>
            <button type='submit' disabled={busy} className='btn-primary'>
              {busy ? t.saving : t.save}
            </button>
            <button
              type='button'
              disabled={busy}
              className='btn-outline'
              onClick={() => void save(true)}>
              {t.saveDraft}
            </button>
          </div>
        </form>
      )}
      <p role='status' className='text-sm text-secondary'>
        {message}
      </p>
      {id ? (
        <MediaManager
          entryId={id}
          initialImages={initialImages}
          onImagesChange={setImages}
        />
      ) : (
        <p className='rounded-xl border border-border bg-surface p-6 text-sm text-secondary'>
          {t.saveFirst}
        </p>
      )}
    </div>
  )
}
