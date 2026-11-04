'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useI18n } from '@/lib/i18n/I18nProvider'
import {
  CropPosition,
  exportAvatarCrop,
  getAvatarCrop
} from '@/utils/avatarCrop'

interface Props {
  file: File
  onConfirm: (file: File) => void
  onCancel: () => void
}

export default function AvatarCropDialog({ file, onConfirm, onCancel }: Props) {
  const { t } = useI18n()
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState<CropPosition>({ x: 0.5, y: 0.5 })
  const [error, setError] = useState(false)
  const [saving, setSaving] = useState(false)
  const drag = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element?.showModal()
    const url = URL.createObjectURL(file)
    const decoded = new Image()
    let active = true
    decoded.onload = () => {
      if (active) setImage(decoded)
    }
    decoded.onerror = () => {
      if (active) setError(true)
    }
    decoded.src = url
    return () => {
      active = false
      URL.revokeObjectURL(url)
      element?.close()
      document.body.style.overflow = overflow
      previousFocus?.focus()
    }
  }, [file])

  useEffect(() => {
    if (!image || !canvas.current) return
    const context = canvas.current.getContext('2d')
    if (!context) return
    const crop = getAvatarCrop(
      image.naturalWidth,
      image.naturalHeight,
      zoom,
      position
    )
    context.clearRect(0, 0, 512, 512)
    context.drawImage(
      image,
      crop.x,
      crop.y,
      crop.size,
      crop.size,
      0,
      0,
      512,
      512
    )
  }, [image, position, zoom])

  const move = (dx: number, dy: number) => {
    if (!image || !canvas.current) return
    const viewSize = canvas.current.getBoundingClientRect().width
    setPosition((previous) => {
      const { x, y, size } = getAvatarCrop(
        image.naturalWidth,
        image.naturalHeight,
        zoom,
        previous
      )
      return {
        x:
          Math.max(
            size / 2,
            Math.min(
              image.naturalWidth - size / 2,
              x + size / 2 - (dx * size) / viewSize
            )
          ) / image.naturalWidth,
        y:
          Math.max(
            size / 2,
            Math.min(
              image.naturalHeight - size / 2,
              y + size / 2 - (dy * size) / viewSize
            )
          ) / image.naturalHeight
      }
    })
  }

  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-hint`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation()
      }}
      onCancel={(event) => {
        event.preventDefault()
        if (!saving) onCancel()
      }}
      className='fixed inset-0 m-auto max-h-dvh w-full max-w-lg overflow-y-auto rounded-none bg-surface p-6 text-sm text-primary backdrop:bg-primary/60 sm:rounded-3xl'>
      <h2 id={`${id}-title`} className='text-xl font-semibold'>
        {t('cropAvatarTitle')}
      </h2>
      <p id={`${id}-hint`} className='mt-2 text-secondary'>
        {t('cropAvatarHint')}
      </p>
      <div className='relative mx-auto mt-6 aspect-square w-full max-w-80 overflow-hidden rounded-xl bg-neutral'>
        <canvas
          ref={canvas}
          width={512}
          height={512}
          tabIndex={0}
          aria-label={t('cropAvatarCanvas')}
          className='block h-full w-full cursor-move touch-none focus-visible:outline-2 focus-visible:outline-tertiary'
          onPointerDown={(event) => {
            if (!image || saving) return
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { x: event.clientX, y: event.clientY }
          }}
          onPointerMove={(event) => {
            if (!drag.current) return
            move(event.clientX - drag.current.x, event.clientY - drag.current.y)
            drag.current = { x: event.clientX, y: event.clientY }
          }}
          onPointerUp={() => {
            drag.current = null
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
          onLostPointerCapture={() => {
            drag.current = null
          }}
          onKeyDown={(event) => {
            const direction = {
              ArrowLeft: [10, 0],
              ArrowRight: [-10, 0],
              ArrowUp: [0, 10],
              ArrowDown: [0, -10]
            }[event.key]
            if (direction && !saving) {
              event.preventDefault()
              move(direction[0], direction[1])
            }
          }}
        />
        <div
          aria-hidden='true'
          className='pointer-events-none absolute inset-0 rounded-full border-2 border-surface'
        />
      </div>
      <label
        htmlFor={`${id}-zoom`}
        className='mt-6 flex items-center justify-between font-medium'>
        {t('cropAvatarZoom')} <span>{zoom.toFixed(1)}×</span>
      </label>
      <input
        id={`${id}-zoom`}
        type='range'
        min={1}
        max={16}
        step={0.1}
        value={zoom}
        disabled={!image || saving}
        onChange={(event) => setZoom(Number(event.target.value))}
        className='mt-2 w-full accent-tertiary'
      />
      <button
        type='button'
        disabled={saving}
        className='mt-2 text-secondary underline'
        onClick={() => {
          setZoom(1)
          setPosition({ x: 0.5, y: 0.5 })
        }}>
        {t('cropAvatarReset')}
      </button>
      {!image && !error && (
        <p role='status' className='mt-4 text-secondary'>
          {t('cropAvatarLoading')}
        </p>
      )}
      {error && (
        <p role='alert' className='mt-4 text-error'>
          {t('cropAvatarError')}
        </p>
      )}
      <div className='mt-6 flex justify-end gap-3'>
        <button
          type='button'
          disabled={saving}
          onClick={onCancel}
          className='btn'>
          {t('cancel')}
        </button>
        <button
          type='button'
          disabled={!image || saving}
          className='btn-primary disabled:opacity-60'
          onClick={async () => {
            if (!image) return
            setSaving(true)
            setError(false)
            try {
              onConfirm(
                await exportAvatarCrop(image, file.name, zoom, position)
              )
            } catch {
              setError(true)
              setSaving(false)
            }
          }}>
          {saving ? t('saving') : t('cropAvatarApply')}
        </button>
      </div>
    </dialog>,
    document.body
  )
}
