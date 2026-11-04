'use client'

import { useRef, useState } from 'react'

import { removeContentImage, updateContentImage } from '@/app/actions/content'
import { attachMediaAsset } from '@/app/actions/media'
import ImageUploadQueue from '@/components/ImageUploadQueue'
import MediaPicker from '@/components/media/MediaPicker'
import { contentText } from '@/lib/i18n/content'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { mediaText } from '@/lib/i18n/media'
import type { ContentImage as ImageRecord } from '@/types/content'
import type { MediaAsset } from '@/types/media'
import { MAX_CONTENT_IMAGE_BYTES } from '@/utils/content'
import { uploadMediaAsset } from '@/utils/media-client'

import ContentImage from './ContentImage'

function ImageEditor({
  image,
  onRemove,
  onChange,
  protectedImage
}: {
  image: ImageRecord
  onRemove: () => void
  onChange: (image: ImageRecord) => void
  protectedImage: boolean
}) {
  const { locale } = useI18n(),
    t = contentText(locale)
  const [value, setValue] = useState(image),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [message, setMessage] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const result = await updateContentImage(
        image.id,
        value.alt,
        value.caption,
        value.position
      )
      if (result.error) setMessage(t.error)
      else {
        onChange(value)
        setMessage(t.imageDetailsSaved)
      }
    } catch {
      setMessage(t.error)
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    setBusy(true)
    setMessage('')
    try {
      const result = await removeContentImage(image.id)
      if (result.error) setMessage(t.error)
      else onRemove()
    } catch {
      setMessage(t.error)
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }
  return (
    <form onSubmit={save} className='space-y-3'>
      <ContentImage
        image={image}
        className='h-48 w-full rounded-xl bg-neutral object-contain'
      />
      <label className='content-field'>
        {t.alt}
        <input
          className='content-control'
          required
          maxLength={300}
          value={value.alt}
          onChange={(e) => setValue({ ...value, alt: e.target.value })}
        />
      </label>
      <label className='content-field'>
        {t.caption}
        <textarea
          className='content-control'
          rows={2}
          maxLength={1000}
          value={value.caption}
          onChange={(e) => setValue({ ...value, caption: e.target.value })}
        />
      </label>
      <label className='content-field'>
        {t.position}
        <input
          className='content-control'
          type='number'
          min={0}
          max={10000}
          required
          value={value.position}
          onChange={(e) =>
            setValue({ ...value, position: Number(e.target.value) })
          }
        />
      </label>
      <div className='flex flex-wrap gap-2'>
        <button disabled={busy} className='btn-outline' type='submit'>
          {t.saveImageDetails}
        </button>
        {!protectedImage && (
          <button
            disabled={busy}
            type='button'
            className='btn-outline text-error'
            onClick={() => (confirm ? void remove() : setConfirm(true))}>
            {confirm
              ? mediaText(locale).confirmDetach
              : mediaText(locale).detach}
          </button>
        )}
        {confirm && (
          <button
            type='button'
            className='btn-outline'
            onClick={() => setConfirm(false)}>
            {t.cancel}
          </button>
        )}
      </div>
      <p role='status' className='text-sm text-secondary'>
        {busy ? t.saving : message}
      </p>
    </form>
  )
}

export default function MediaManager({
  entryId,
  initialImages,
  onImagesChange,
  onSelect,
  selectedId,
  protectedId,
  selectionFormId,
  selectionPending = false,
  selectionBusy = false,
  selectionStatus = ''
}: {
  entryId: string | null
  initialImages: ImageRecord[]
  onImagesChange?: (images: ImageRecord[]) => void
  onSelect?: (image: ImageRecord) => void
  selectedId?: string | null
  protectedId?: string | null
  selectionFormId?: string
  selectionPending?: boolean
  selectionBusy?: boolean
  selectionStatus?: string
}) {
  const { locale } = useI18n(),
    t = contentText(locale)
  const [images, setImages] = useState(initialImages)
  const [showPicker, setShowPicker] = useState(false)
  const imagesRef = useRef(initialImages)
  function update(next: ImageRecord[]) {
    next.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    imagesRef.current = next
    setImages(next)
    onImagesChange?.(next)
  }
  async function attachAsset(asset: MediaAsset) {
    const result = await attachMediaAsset(asset.id, entryId)
    if (result.error || !result.image) throw new Error(mediaText(locale).error)
    const image = result.image as ImageRecord
    const firstImage = imagesRef.current.length === 0
    update([
      ...imagesRef.current.filter((value) => value.id !== image.id),
      image
    ])
    if (firstImage && !selectedId) onSelect?.(image)
  }
  async function upload(file: File) {
    const { asset } = await uploadMediaAsset(file, false, locale)
    await attachAsset(asset)
  }
  return (
    <section className='space-y-6' aria-label={t.images}>
      <div className='space-y-2'>
        <h2 className='font-serif text-2xl font-semibold'>{t.images}</h2>
        <p className='text-sm text-secondary'>{t.imageHelp}</p>
      </div>
      <button
        type='button'
        className='btn-outline'
        disabled={images.length >= 100}
        onClick={() => setShowPicker(true)}>
        {mediaText(locale).choose}
      </button>
      {showPicker && (
        <MediaPicker
          selected={images
            .map((image) => image.asset_id)
            .filter((id): id is string => !!id)}
          onSelect={attachAsset}
          onClose={() => setShowPicker(false)}
        />
      )}
      <ImageUploadQueue
        maxBytes={MAX_CONTENT_IMAGE_BYTES}
        allowedTypes={['image/jpeg', 'image/png', 'image/webp']}
        maxFiles={Math.max(0, 100 - images.length)}
        onUpload={upload}
      />
      <div className='grid items-start gap-6 md:grid-cols-2'>
        {images.map((image) => (
          <div
            key={image.id}
            className='space-y-4 rounded-xl border border-border p-6'>
            {onSelect && (
              <div className='space-y-3'>
                <label className='flex items-center gap-2 text-sm'>
                  <input
                    type='radio'
                    name='cover-selection'
                    checked={selectedId === image.id}
                    disabled={selectionBusy}
                    onChange={() => onSelect(image)}
                    className='accent-tertiary'
                  />
                  {t.cover}
                </label>
                {selectedId === image.id && (
                  <>
                    <p className='text-sm text-secondary'>
                      {selectionPending ? t.coverPending : t.coverCurrent}
                    </p>
                    {selectionFormId && (
                      <button
                        type='submit'
                        form={selectionFormId}
                        disabled={selectionBusy || !selectionPending}
                        className='btn-primary'>
                        {selectionBusy ? t.saving : t.saveCover}
                      </button>
                    )}
                    <p role='status' className='text-sm text-secondary'>
                      {selectionStatus}
                    </p>
                  </>
                )}
              </div>
            )}
            <ImageEditor
              image={image}
              protectedImage={image.id === protectedId}
              onChange={(value) =>
                update(
                  imagesRef.current.map((i) => (i.id === image.id ? value : i))
                )
              }
              onRemove={() =>
                update(imagesRef.current.filter((i) => i.id !== image.id))
              }
            />
          </div>
        ))}
      </div>
    </section>
  )
}
