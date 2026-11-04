'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { listMediaAssets } from '@/app/actions/media'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { mediaText } from '@/lib/i18n/media'
import { mediaImageUrl, type MediaAsset } from '@/types/media'

export default function MediaPicker({
  onSelect,
  onClose,
  selected = []
}: {
  onSelect: (asset: MediaAsset) => Promise<void>
  onClose: () => void
  selected?: string[]
}) {
  const { locale } = useI18n(),
    t = mediaText(locale),
    id = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [assets, setAssets] = useState<MediaAsset[]>([]),
    [term, setTerm] = useState(''),
    [page, setPage] = useState(0),
    [count, setCount] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const requestRef = useRef(0)
  async function load(search: string, index: number) {
    const request = ++requestRef.current
    setBusy(true)
    setMessage('')
    try {
      const result = await listMediaAssets(search, index)
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
  useEffect(() => {
    const dialog = dialogRef.current,
      focus = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog?.showModal()
    // Defer initial fetch so it shares the explicit search/loading path.
    const timer = setTimeout(() => void load('', 0), 0)
    return () => {
      clearTimeout(timer)
      // Invalidate pending requests rather than updating an unmounted picker.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestRef.current++
      dialog?.close()
      document.body.style.overflow = overflow
      focus?.focus()
    }
    // Search is handled by form submission; open once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-heading`}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation()
      }}
      className='fixed inset-0 m-auto max-h-dvh w-full max-w-5xl overflow-y-auto rounded-none bg-surface p-4 text-sm text-primary backdrop:bg-stone-900/60 sm:rounded-3xl sm:p-8'>
      <div className='mb-4 flex items-center justify-between gap-4'>
        <h2 id={`${id}-heading`} className='font-serif text-2xl font-semibold'>
          {t.choose}
        </h2>
        <button type='button' onClick={onClose} disabled={busy} className='btn'>
          {t.close}
        </button>
      </div>
      <p className='mb-4 text-sm text-secondary'>{t.privacy}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void load(term, 0)
        }}
        className='mb-6 flex gap-3'>
        <input
          aria-label={t.search}
          className='content-control min-w-0 flex-1'
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
        <button className='btn' disabled={busy}>
          {t.searchButton}
        </button>
      </form>
      <div className='columns-2 gap-4 sm:columns-3 lg:columns-4'>
        {assets.map((asset) => (
          <div
            key={asset.id}
            className='mb-4 break-inside-avoid space-y-2 rounded-xl border border-border p-2'>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mediaImageUrl(asset.id)}
              alt={asset.title}
              width={asset.width || undefined}
              height={asset.height || undefined}
              loading='lazy'
              className='h-auto w-full rounded-lg'
            />
            <p className='text-sm wrap-break-word'>{asset.title}</p>
            <button
              type='button'
              disabled={busy || selected.includes(asset.id)}
              className='btn-outline w-full'
              onClick={async () => {
                setBusy(true)
                setMessage('')
                try {
                  await onSelect(asset)
                } catch {
                  setMessage(t.error)
                } finally {
                  setBusy(false)
                }
              }}>
              {selected.includes(asset.id) ? t.selected : t.select}
            </button>
          </div>
        ))}
      </div>
      {!assets.length && !busy && <p>{t.empty}</p>}
      <p role='status' className='my-4 text-secondary'>
        {busy ? t.loading : message}
      </p>
      {assets.length < count && (
        <button
          type='button'
          className='btn'
          disabled={busy}
          onClick={() => void load(term, page + 1)}>
          {t.more}
        </button>
      )}
    </dialog>,
    document.body
  )
}
