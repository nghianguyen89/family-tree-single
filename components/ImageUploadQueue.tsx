'use client'

import { useEffect, useId, useRef, useState } from 'react'

import { useI18n } from '@/lib/i18n/I18nProvider'
import { imageUploadText } from '@/lib/i18n/image-upload'
import {
  AUTO_COMPRESS_IMAGE_BYTES,
  compressUploadImage,
  ImageCompressionError,
  MAX_SOURCE_IMAGE_BYTES
} from '@/utils/image-compression'
import { imageFileProblem } from '@/utils/image-upload'

type Status = 'pending' | 'compressing' | 'uploading' | 'uploaded' | 'failed'
interface QueuedImage {
  id: string
  file: File
  status: Status
  error?: string
  prepared?: File
  uploadBytes?: number
}
interface Props {
  maxBytes: number
  allowedTypes: readonly string[]
  maxFiles?: number
  onUpload: (file: File) => Promise<void>
  onBusyChange?: (busy: boolean) => void
}

export function ImageFileThumbnail({ file, alt }: { file: File; alt: string }) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [failedFile, setFailedFile] = useState<File | null>(null)
  useEffect(() => {
    const value = URL.createObjectURL(file)
    if (imageRef.current) imageRef.current.src = value
    return () => URL.revokeObjectURL(value)
  }, [file])
  return (
    <div className='flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-neutral'>
      {failedFile === file && (
        <p className='p-2 text-sm text-secondary'>{alt}</p>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imageRef}
        hidden={failedFile === file}
        alt={file.name}
        className='h-full w-full object-contain'
        onError={() => setFailedFile(file)}
      />
    </div>
  )
}

export default function ImageUploadQueue({
  maxBytes,
  allowedTypes,
  maxFiles = 100,
  onUpload,
  onBusyChange
}: Props) {
  const { locale } = useI18n()
  const t = imageUploadText(locale)
  const id = useId()
  const [images, setImages] = useState<QueuedImage[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const runningRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  function add(files: File[]) {
    if (runningRef.current) return
    const valid: File[] = []
    const errors: string[] = []
    for (const file of files) {
      const issue = imageFileProblem(file, MAX_SOURCE_IMAGE_BYTES, allowedTypes)
      if (issue) errors.push(`${file.name}: ${t[issue]}`)
      else valid.push(file)
    }
    const waiting = images.filter((image) => image.status !== 'uploaded').length
    const slots = Math.max(0, maxFiles - waiting)
    if (valid.length > slots) errors.push(t.limit)
    setImages((previous) => [
      ...previous,
      ...valid.slice(0, slots).map((file) => ({
        id: crypto.randomUUID(),
        file,
        status: 'pending' as const
      }))
    ])
    setMessage(errors.join('\n'))
  }
  async function upload() {
    if (runningRef.current) return
    const pending = images.filter(
      (image) => image.status === 'pending' || image.status === 'failed'
    )
    if (!pending.length) return
    runningRef.current = true
    setBusy(true)
    setMessage('')
    onBusyChange?.(true)
    const change = (id: string, patch: Partial<QueuedImage>) => {
      if (mountedRef.current)
        setImages((previous) =>
          previous.map((image) =>
            image.id === id ? { ...image, ...patch } : image
          )
        )
    }
    try {
      for (const image of pending) {
        if (!mountedRef.current) break
        try {
          const limit = Math.min(maxBytes, AUTO_COMPRESS_IMAGE_BYTES)
          if (!image.prepared && image.file.size > limit)
            change(image.id, { status: 'compressing', error: undefined })
          const prepared =
            image.prepared || (await compressUploadImage(image.file, limit))
          if (!mountedRef.current) break
          change(image.id, {
            status: 'uploading',
            error: undefined,
            prepared,
            uploadBytes: prepared.size
          })
          await onUpload(prepared)
          change(image.id, { status: 'uploaded', prepared: undefined })
        } catch (error) {
          change(image.id, {
            status: 'failed',
            error:
              error instanceof ImageCompressionError
                ? t.compressionError
                : error instanceof Error
                  ? error.message
                  : t.network
          })
        }
      }
    } finally {
      runningRef.current = false
      if (mountedRef.current) {
        setBusy(false)
        onBusyChange?.(false)
      }
    }
  }
  const successful = images.filter(
    (image) => image.status === 'uploaded'
  ).length
  const waiting = images.length - successful
  const formats = allowedTypes
    .map((type) => type.replace('image/', '').toUpperCase())
    .join(', ')
  return (
    <section
      aria-label={t.choose}
      className='space-y-4 rounded-xl border border-border bg-neutral p-4 sm:p-6'
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        add(Array.from(event.dataTransfer.files))
      }}>
      <div className='space-y-2'>
        <label htmlFor={id} className='block text-sm font-medium text-primary'>
          {t.choose}
        </label>
        <p id={`${id}-hint`} className='text-sm text-secondary'>
          {t.hint}
        </p>
        <input
          id={id}
          type='file'
          multiple
          accept={allowedTypes.join(',')}
          disabled={busy || maxFiles <= waiting}
          aria-describedby={`${id}-hint ${id}-limits`}
          className='block w-full rounded-lg border border-border bg-surface p-3 text-sm text-primary disabled:opacity-60'
          onChange={(event) => {
            add(Array.from(event.target.files || []))
            event.target.value = ''
          }}
        />
        <p id={`${id}-limits`} className='text-sm text-secondary'>
          {t.limits(
            Math.min(maxBytes, AUTO_COMPRESS_IMAGE_BYTES) / 1024 / 1024,
            formats,
            Math.max(0, maxFiles - waiting)
          )}
        </p>
        <p className='text-sm text-secondary'>{t.compressionHelp}</p>
        <p className='text-sm text-secondary'>{t.detailsLater}</p>
      </div>
      {message && (
        <p role='alert' className='text-sm whitespace-pre-line text-error'>
          {message}
        </p>
      )}
      <ul className='grid grid-cols-2 gap-4 sm:grid-cols-3'>
        {images.map((image) => (
          <li
            key={image.id}
            className='min-w-0 space-y-2 rounded-xl border border-border bg-surface p-2'>
            <ImageFileThumbnail file={image.file} alt={t.previewError} />
            <p
              className='truncate text-sm text-primary'
              title={image.file.name}>
              {image.file.name}
            </p>
            <p
              className={`text-sm ${image.status === 'failed' ? 'text-error' : 'text-secondary'}`}>
              {t[image.status]}
            </p>
            {image.error && (
              <p className='text-sm wrap-break-word text-error'>
                {image.error}
              </p>
            )}
            {image.uploadBytes !== undefined &&
              image.uploadBytes < image.file.size && (
                <p className='text-sm text-secondary'>
                  {t.compressed(
                    (image.file.size / 1024 / 1024).toFixed(1),
                    (image.uploadBytes / 1024 / 1024).toFixed(1)
                  )}
                </p>
              )}
            {image.status !== 'uploaded' && (
              <button
                type='button'
                disabled={busy}
                className='text-sm text-secondary underline disabled:opacity-60'
                aria-label={`${t.remove}: ${image.file.name}`}
                onClick={() =>
                  setImages((previous) =>
                    previous.filter((item) => item.id !== image.id)
                  )
                }>
                {t.remove}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p role='status' aria-live='polite' className='text-sm text-secondary'>
        {images.length ? t.progress(successful, images.length) : t.empty}
      </p>
      <div className='flex flex-wrap gap-3'>
        <button
          type='button'
          disabled={busy || !waiting}
          onClick={() => void upload()}
          className='btn-primary disabled:opacity-60'>
          {busy
            ? t.uploading
            : images.some((image) => image.status === 'failed')
              ? t.retry
              : t.upload}
        </button>
        {!!successful && (
          <button
            type='button'
            disabled={busy}
            className='btn'
            onClick={() =>
              setImages((previous) =>
                previous.filter((image) => image.status !== 'uploaded')
              )
            }>
            {t.clear}
          </button>
        )}
      </div>
    </section>
  )
}
