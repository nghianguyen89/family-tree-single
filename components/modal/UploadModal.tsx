'use client'

import Image from 'next/image'
import { useEffect, useId, useState } from 'react'

import ImageUploadQueue, {
  ImageFileThumbnail
} from '@/components/ImageUploadQueue'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { imageUploadText } from '@/lib/i18n/image-upload'
import type { GalleryItem } from '@/types'
import { saveGalleryImage } from '@/utils/gallery-images'
import { MAX_SOURCE_IMAGE_BYTES } from '@/utils/image-compression'
import { imageFileProblem } from '@/utils/image-upload'

const TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024

interface UploadModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  initialData?: GalleryItem | null
}

export default function UploadModal({
  isOpen,
  onClose,
  onSuccess,
  initialData
}: UploadModalProps) {
  const { t, locale } = useI18n()
  const text = imageUploadText(locale)
  const id = useId()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState(initialData?.title || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [eventDate, setEventDate] = useState(initialData?.event_date || '')
  const [busy, setBusy] = useState(false)
  const [uploaded, setUploaded] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!isOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [isOpen])

  if (!isOpen) return null
  const close = () => {
    if (busy) return
    if (uploaded) onSuccess()
    else onClose()
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!initialData || busy || !title.trim()) return
    setBusy(true)
    setError('')
    try {
      await saveGalleryImage(
        file,
        { title, description, eventDate },
        initialData
      )
      onSuccess()
    } catch {
      setError(t('uploadError'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className='fixed inset-0 z-100 flex items-center justify-center bg-stone-900/40 p-4 sm:p-6'>
      <div className='absolute inset-0' onClick={close} />
      <section
        role='dialog'
        aria-modal='true'
        aria-labelledby={`${id}-title`}
        className='relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-border bg-surface p-4 text-sm text-primary sm:p-8'>
        <div className='mb-6 flex items-center justify-between gap-4'>
          <h2 id={`${id}-title`} className='font-serif text-xl font-semibold'>
            {initialData ? t('editImage') : t('addToGallery')}
          </h2>
          <button type='button' disabled={busy} className='btn' onClick={close}>
            {t('close')}
          </button>
        </div>
        {initialData ? (
          <form onSubmit={save} className='space-y-4'>
            {file ? (
              <ImageFileThumbnail file={file} alt={text.previewError} />
            ) : (
              <Image
                unoptimized
                src={initialData.image_url}
                width={800}
                height={600}
                alt={title}
                className='max-h-64 w-full rounded-xl bg-neutral object-contain'
              />
            )}
            <label className='content-field'>
              {t('chooseNewPhoto')}
              <input
                type='file'
                accept={TYPES.join(',')}
                disabled={busy}
                className='content-control'
                onChange={(event) => {
                  const selected = event.target.files?.[0]
                  event.target.value = ''
                  if (!selected) return
                  const issue = imageFileProblem(
                    selected,
                    MAX_SOURCE_IMAGE_BYTES,
                    TYPES
                  )
                  if (issue) {
                    setError(text[issue])
                    return
                  }
                  setError('')
                  setFile(selected)
                }}
              />
            </label>
            <p className='text-secondary'>{text.compressionHelp}</p>
            {file && (
              <button
                type='button'
                disabled={busy}
                className='btn'
                onClick={() => setFile(null)}>
                {text.remove}
              </button>
            )}
            <label className='content-field'>
              {t('imageTitle')}
              <input
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className='content-control'
                disabled={busy}
              />
            </label>
            <label className='content-field'>
              {t('eventDate')}
              <input
                type='date'
                value={eventDate}
                onChange={(event) => setEventDate(event.target.value)}
                className='content-control'
                disabled={busy}
              />
            </label>
            <label className='content-field'>
              {t('eventDescription')}
              <textarea
                rows={4}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className='content-control'
                disabled={busy}
              />
            </label>
            {error && (
              <p role='alert' className='text-error'>
                {error}
              </p>
            )}
            <div className='flex justify-end gap-3'>
              <button
                type='button'
                disabled={busy}
                onClick={close}
                className='btn'>
                {t('cancel')}
              </button>
              <button
                disabled={busy || !title.trim()}
                className='btn-primary'
                type='submit'>
                {busy ? t('saving') : t('saveChanges')}
              </button>
            </div>
          </form>
        ) : (
          <>
            <ImageUploadQueue
              maxBytes={MAX_BYTES}
              allowedTypes={TYPES}
              onBusyChange={setBusy}
              onUpload={async (selected) => {
                try {
                  await saveGalleryImage(selected)
                  setUploaded(true)
                } catch {
                  throw new Error(t('uploadError'))
                }
              }}
            />
            <div className='mt-6 flex justify-end'>
              <button
                type='button'
                disabled={busy}
                onClick={close}
                className='btn'>
                {uploaded ? text.done : t('cancel')}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
