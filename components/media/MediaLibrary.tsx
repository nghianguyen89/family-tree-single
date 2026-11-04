'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  listMediaAssets,
  removeMediaAsset,
  updateMediaAsset
} from '@/app/actions/media'
import ImageUploadQueue from '@/components/ImageUploadQueue'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { mediaText } from '@/lib/i18n/media'
import { mediaImageUrl, type MediaAsset } from '@/types/media'
import { MAX_CONTENT_IMAGE_BYTES } from '@/utils/content'
import { uploadMediaAsset } from '@/utils/media-client'

import PhotoGallery from './PhotoGallery'

function AssetEditor({
  asset,
  onClose,
  onSaved
}: {
  asset: MediaAsset
  onClose: () => void
  onSaved: (value: MediaAsset) => void
}) {
  const { locale } = useI18n(),
    t = mediaText(locale),
    id = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [value, setValue] = useState(asset),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  useEffect(() => {
    const element = dialogRef.current,
      focus = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element?.showModal()
    return () => {
      element?.close()
      document.body.style.overflow = overflow
      focus?.focus()
    }
  }, [])
  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
      className='fixed inset-0 m-auto max-h-dvh w-full max-w-2xl overflow-y-auto rounded-none bg-surface p-6 text-sm text-primary backdrop:bg-stone-900/60 sm:rounded-3xl'>
      <h2 id={`${id}-title`} className='text-xl font-semibold'>
        {t.edit}
      </h2>
      <p className='mt-2 text-secondary'>{t.editHelp}</p>
      <form
        className='mt-6 space-y-4'
        onSubmit={async (event) => {
          event.preventDefault()
          if (busy) return
          setBusy(true)
          setMessage('')
          try {
            const result = await updateMediaAsset(asset.id, {
              title: value.title,
              description: value.description,
              event_date: value.event_date,
              library_visible: value.library_visible
            })
            if (result.error) setMessage(t.error)
            else {
              onSaved(value)
              onClose()
            }
          } catch {
            setMessage(t.error)
          } finally {
            setBusy(false)
          }
        }}>
        <label className='content-field'>
          {t.title}
          <input
            className='content-control'
            maxLength={300}
            required
            disabled={busy}
            value={value.title}
            onChange={(event) =>
              setValue({ ...value, title: event.target.value })
            }
          />
        </label>
        <label className='content-field'>
          {t.description}
          <textarea
            className='content-control'
            rows={4}
            maxLength={4000}
            disabled={busy}
            value={value.description}
            onChange={(event) =>
              setValue({ ...value, description: event.target.value })
            }
          />
        </label>
        <label className='content-field'>
          {t.date}
          <input
            type='date'
            className='content-control'
            disabled={busy}
            value={value.event_date || ''}
            onChange={(event) =>
              setValue({ ...value, event_date: event.target.value || null })
            }
          />
        </label>
        <label className='flex items-start gap-2'>
          <input
            type='checkbox'
            className='mt-1 accent-tertiary'
            disabled={busy}
            checked={value.library_visible}
            onChange={(event) =>
              setValue({ ...value, library_visible: event.target.checked })
            }
          />
          {t.internal}
        </label>
        <p className='text-secondary'>{t.privacy}</p>
        <p role='status'>{message}</p>
        <div className='flex justify-end gap-3'>
          <button
            type='button'
            disabled={busy}
            className='btn'
            onClick={onClose}>
            {t.cancel}
          </button>
          <button className='btn-primary' disabled={busy}>
            {t.save}
          </button>
        </div>
      </form>
    </dialog>,
    document.body
  )
}

export default function MediaLibrary({
  initialAssets,
  count: initialCount,
  editable,
  error = false
}: {
  initialAssets: MediaAsset[]
  count: number
  editable: boolean
  error?: boolean
}) {
  const { locale } = useI18n(),
    t = mediaText(locale)
  const [assets, setAssets] = useState(initialAssets),
    [count, setCount] = useState(initialCount),
    [term, setTerm] = useState(''),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [message, setMessage] = useState(error ? t.schema : ''),
    [showUpload, setShowUpload] = useState(false),
    [editing, setEditing] = useState<MediaAsset | null>(null),
    [confirm, setConfirm] = useState<string | null>(null)
  const requestRef = useRef(0)
  async function load(index: number) {
    const request = ++requestRef.current
    setBusy(true)
    setMessage('')
    try {
      const result = await listMediaAssets(term, index)
      if (request !== requestRef.current) return
      if (result.error) {
        setMessage(t.schema)
        return
      }
      setAssets((previous) =>
        index
          ? [
              ...previous,
              ...result.assets.filter(
                (asset) => !previous.some((old) => old.id === asset.id)
              )
            ]
          : result.assets
      )
      setCount(result.count)
      setPage(index)
    } catch {
      if (request === requestRef.current) setMessage(t.error)
    } finally {
      if (request === requestRef.current) setBusy(false)
    }
  }
  return (
    <section className='space-y-6'>
      <header className='flex flex-wrap items-start justify-between gap-4'>
        <div className='max-w-3xl space-y-2'>
          <h1 className='title'>{t.library}</h1>
          <p className='text-sm text-secondary'>{t.help}</p>
          {editable && <p className='text-sm text-secondary'>{t.privacy}</p>}
        </div>
        {editable && (
          <button
            type='button'
            className='btn-primary'
            disabled={uploading || error}
            onClick={() => setShowUpload((value) => !value)}>
            {showUpload ? t.close : t.upload}
          </button>
        )}
      </header>
      {showUpload && (
        <ImageUploadQueue
          maxBytes={MAX_CONTENT_IMAGE_BYTES}
          allowedTypes={['image/jpeg', 'image/png', 'image/webp', 'image/gif']}
          onBusyChange={setUploading}
          onUpload={async (file) => {
            const result = await uploadMediaAsset(file, true, locale)
            setAssets((previous) => [
              result.asset,
              ...previous.filter((asset) => asset.id !== result.asset.id)
            ])
            if (!result.reused) setCount((previous) => previous + 1)
            setMessage(result.reused ? t.reused : '')
          }}
        />
      )}
      <form
        className='flex gap-3'
        onSubmit={(event) => {
          event.preventDefault()
          void load(0)
        }}>
        <input
          type='search'
          className='content-control min-w-0 flex-1'
          aria-label={t.search}
          placeholder={t.search}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
        <button className='btn' disabled={busy || uploading}>
          {t.searchButton}
        </button>
      </form>
      <p role='status' className='text-sm text-secondary'>
        {busy ? t.loading : message}
      </p>
      <PhotoGallery
        locale={locale}
        className='columns-2 gap-4 space-y-4 md:columns-3 xl:columns-4'>
        {assets.map((asset) => (
          <figure
            key={asset.id}
            data-asset-id={asset.id}
            className='mb-4 break-inside-avoid overflow-hidden rounded-xl border border-border bg-surface'>
            <a
              href={mediaImageUrl(asset.id)}
              data-photo-view
              data-pswp-width={asset.width || undefined}
              data-pswp-height={asset.height || undefined}
              data-caption={[asset.title, asset.description]
                .filter(Boolean)
                .join(' — ')}
              aria-label={`${t.view}: ${asset.title}`}
              className='block'>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mediaImageUrl(asset.id)}
                alt={asset.title}
                width={asset.width || undefined}
                height={asset.height || undefined}
                loading='lazy'
                decoding='async'
                className='block h-auto w-full'
                onLoad={(event) => {
                  const image = event.currentTarget
                  image.parentElement!.dataset.pswpWidth = String(
                    image.naturalWidth
                  )
                  image.parentElement!.dataset.pswpHeight = String(
                    image.naturalHeight
                  )
                  image.dataset.orientation =
                    image.naturalHeight > image.naturalWidth
                      ? 'portrait'
                      : image.naturalWidth > image.naturalHeight
                        ? 'landscape'
                        : 'square'
                }}
              />
            </a>
            <figcaption className='space-y-2 p-3'>
              <p className='text-sm font-medium wrap-break-word text-primary'>
                {asset.title}
              </p>
              {asset.event_date && (
                <p className='text-sm text-secondary'>{asset.event_date}</p>
              )}
              {asset.description && (
                <p className='line-clamp-3 text-sm wrap-break-word text-secondary'>
                  {asset.description}
                </p>
              )}
              {editable && (
                <>
                  <p className='text-sm text-secondary'>
                    {asset.library_visible ? t.libraryVisible : t.private}
                  </p>
                  <div className='flex flex-wrap gap-2'>
                    <button
                      type='button'
                      disabled={busy || uploading}
                      className='btn-outline'
                      onClick={() => setEditing(asset)}>
                      {t.edit}
                    </button>
                    <button
                      type='button'
                      disabled={busy || uploading}
                      className='text-sm text-error underline'
                      onClick={async () => {
                        if (confirm !== asset.id) {
                          setConfirm(asset.id)
                          return
                        }
                        setBusy(true)
                        setMessage('')
                        try {
                          const result = await removeMediaAsset(asset.id)
                          if (result.error)
                            setMessage(
                              result.error === 'inUse' ? t.inUse : t.error
                            )
                          else {
                            setAssets((previous) =>
                              previous.filter((image) => image.id !== asset.id)
                            )
                            setCount((previous) => Math.max(0, previous - 1))
                          }
                        } catch {
                          setMessage(t.error)
                        } finally {
                          setBusy(false)
                          setConfirm(null)
                        }
                      }}>
                      {confirm === asset.id ? t.confirm : t.remove}
                    </button>
                    {confirm === asset.id && (
                      <button
                        className='btn'
                        type='button'
                        onClick={() => setConfirm(null)}>
                        {t.cancel}
                      </button>
                    )}
                  </div>
                </>
              )}
            </figcaption>
          </figure>
        ))}
      </PhotoGallery>
      {!assets.length && !busy && (
        <p className='text-sm text-secondary'>{t.empty}</p>
      )}
      {assets.length < count && (
        <button
          className='btn'
          type='button'
          disabled={busy || uploading}
          onClick={() => void load(page + 1)}>
          {t.more}
        </button>
      )}
      {editing && (
        <AssetEditor
          key={editing.id}
          asset={editing}
          onClose={() => setEditing(null)}
          onSaved={(value) =>
            setAssets((previous) =>
              previous.map((asset) => (asset.id === value.id ? value : asset))
            )
          }
        />
      )}
    </section>
  )
}
