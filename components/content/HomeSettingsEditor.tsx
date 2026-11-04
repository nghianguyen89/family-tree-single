'use client'

import Link from 'next/link'
import { useId, useState } from 'react'

import { saveHomeSettings } from '@/app/actions/content'
import { contentText } from '@/lib/i18n/content'
import { useI18n } from '@/lib/i18n/I18nProvider'
import type { ContentImage, HomeSettings } from '@/types/content'

import MediaManager from './MediaManager'

export default function HomeSettingsEditor({
  initial,
  images
}: {
  initial: HomeSettings
  images: ContentImage[]
}) {
  const { locale } = useI18n(),
    t = contentText(locale)
  const settingsFormId = useId()
  const [value, setValue] = useState(initial),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [persistedCover, setPersistedCover] = useState(initial.cover_image_id)
  function move(index: number, direction: number) {
    const order = [...value.section_order],
      next = index + direction
    if (next < 0 || next >= order.length) return
    ;[order[index], order[next]] = [order[next], order[index]]
    setValue({ ...value, section_order: order })
  }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const result = await saveHomeSettings(value)
      if (result.error)
        setMessage(
          result.error === 'conflict'
            ? t.conflict
            : result.error === 'invalid'
              ? t.invalid
              : result.error === 'migration'
                ? t.migration
                : t.error
        )
      else {
        setValue((prev) => ({ ...prev, revision: result.revision! }))
        setPersistedCover(value.cover_image_id)
        setMessage(t.homeSettingsSaved)
      }
    } catch {
      setMessage(t.error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className='space-y-8'>
      <form
        id={settingsFormId}
        onSubmit={save}
        className='space-y-6 rounded-3xl border border-border bg-surface p-6 sm:p-8'>
        <div className='space-y-2'>
          <h2 className='font-serif text-2xl font-semibold'>
            {t.publicSettings}
          </h2>
          <p className='text-sm text-secondary'>{t.coverHelp}</p>
        </div>
        {(['title', 'subtitle'] as const).map((k) => (
          <label key={k} className='content-field'>
            {t[k]}
            <input
              className='content-control'
              maxLength={k === 'title' ? 200 : 600}
              required={k === 'title'}
              value={value[k]}
              onChange={(e) => setValue({ ...value, [k]: e.target.value })}
            />
          </label>
        ))}
        <fieldset className='space-y-4'>
          <legend className='mb-3 text-sm font-medium'>{t.origin}</legend>
          {(['origin', 'origin_previous'] as const).map((key) => (
            <label key={key} className='content-field'>
              {key === 'origin' ? t.originCurrent : t.originPrevious}
              <textarea
                className='content-control'
                rows={3}
                maxLength={300}
                value={value[key] ?? ''}
                onChange={(event) =>
                  setValue({ ...value, [key]: event.target.value })
                }
              />
            </label>
          ))}
        </fieldset>
        {(['introduction', 'contact'] as const).map((k) => (
          <label key={k} className='content-field'>
            {t[k]}
            <textarea
              className='content-control'
              rows={k === 'introduction' ? 10 : 4}
              maxLength={k === 'introduction' ? 20000 : 2000}
              value={value[k]}
              onChange={(e) => setValue({ ...value, [k]: e.target.value })}
            />
          </label>
        ))}
        <fieldset className='space-y-3'>
          <legend className='mb-3 text-sm font-medium'>{t.sectionOrder}</legend>
          {value.section_order.map((section, index) => (
            <div
              key={section}
              className='flex flex-wrap items-center gap-3 rounded-xl border border-border p-4'>
              <span className='mr-auto text-sm'>
                {index + 1}. {t[section]}
              </span>
              <button
                type='button'
                disabled={index === 0}
                className='btn-outline'
                aria-label={`${t.up}: ${t[section]}`}
                onClick={() => move(index, -1)}>
                {t.up}
              </button>
              <button
                type='button'
                disabled={index === 2}
                className='btn-outline'
                aria-label={`${t.down}: ${t[section]}`}
                onClick={() => move(index, 1)}>
                {t.down}
              </button>
            </div>
          ))}
        </fieldset>
        <label className='flex items-center gap-2 text-sm'>
          <input
            type='checkbox'
            checked={value.cover_image_id === null}
            onChange={(e) => {
              if (e.target.checked) setValue({ ...value, cover_image_id: null })
            }}
          />
          {t.noCoverSelected}
        </label>
        <div className='flex flex-wrap gap-3'>
          <button disabled={busy} type='submit' className='btn-primary'>
            {busy ? t.saving : t.saveHomeSettings}
          </button>
          <Link href='/' target='_blank' className='btn-outline'>
            {t.openHome}
          </Link>
        </div>
        <p role='status' className='text-sm text-secondary'>
          {message}
        </p>
      </form>
      <MediaManager
        entryId={null}
        initialImages={images}
        selectedId={value.cover_image_id}
        protectedId={persistedCover}
        selectionFormId={settingsFormId}
        selectionPending={value.cover_image_id !== persistedCover}
        selectionBusy={busy}
        selectionStatus={message}
        onSelect={(image) => {
          setMessage('')
          setValue((prev) => ({ ...prev, cover_image_id: image.id }))
        }}
        onImagesChange={(next) =>
          setValue((prev) => ({
            ...prev,
            cover_image_id: next.some((i) => i.id === prev.cover_image_id)
              ? prev.cover_image_id
              : null
          }))
        }
      />
    </div>
  )
}
