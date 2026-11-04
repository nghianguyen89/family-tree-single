'use client'

import { Crosshair, ZoomIn, ZoomOut } from 'lucide-react'

import { useI18n } from '@/lib/i18n/I18nProvider'

import BaseToolbar, { type BaseToolbarProps } from './BaseToolbar'

interface TreeToolbarProps extends BaseToolbarProps {
  scale: number
  handleZoomIn: () => void
  handleZoomOut: () => void
  handleResetZoom: () => void
  handleCenter: () => void
}

export default function TreeToolbar({
  scale,
  handleZoomIn,
  handleZoomOut,
  handleResetZoom,
  handleCenter,
  ...baseProps
}: TreeToolbarProps) {
  const { t } = useI18n()

  return (
    <BaseToolbar {...baseProps}>
      {/* Zoom Controls */}
      <div className='flex h-10 items-center overflow-hidden rounded-full border border-stone-200/60 bg-surface transition-opacity'>
        <button
          onClick={handleZoomOut}
          className='h-full px-3 text-stone-600 transition-colors hover:bg-stone-100/50 disabled:opacity-50'
          title={t('zoomOut')}
          disabled={scale <= 0.3}>
          <ZoomOut className='size-4' />
        </button>
        <button
          onClick={handleResetZoom}
          className='h-full min-w-12.5 border-x border-stone-200/50 px-2 text-center text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100/50'
          title={t('resetZoom')}>
          {Math.round(scale * 100)}%
        </button>
        <button
          onClick={handleZoomIn}
          className='h-full px-3 text-stone-600 transition-colors hover:bg-stone-100/50 disabled:opacity-50'
          title={t('zoomIn')}
          disabled={scale >= 2}>
          <ZoomIn className='size-4' />
        </button>
      </div>

      {/* Center Button */}
      <button
        onClick={handleCenter}
        className='flex size-10 items-center justify-center rounded-full border border-stone-200/60 bg-surface text-stone-600 transition-all hover:bg-surface hover:text-stone-900'
        title={t('centerTree')}>
        <Crosshair className='size-4' />
      </button>
    </BaseToolbar>
  )
}
