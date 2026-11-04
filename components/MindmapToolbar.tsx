'use client'

import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'

import { useI18n } from '@/lib/i18n/I18nProvider'

import BaseToolbar, { type BaseToolbarProps } from './BaseToolbar'

interface MindmapToolbarProps extends BaseToolbarProps {
  setExpandSignal: (val: { type: 'expand' | 'collapse'; ts: number }) => void
}

export default function MindmapToolbar({
  setExpandSignal,
  ...baseProps
}: MindmapToolbarProps) {
  const { t } = useI18n()

  return (
    <BaseToolbar {...baseProps}>
      {/* Expand/Collapse Controls */}
      <div className='flex h-10 items-center overflow-hidden rounded-full border border-stone-200/60 bg-surface transition-opacity'>
        <button
          onClick={() => setExpandSignal({ type: 'collapse', ts: Date.now() })}
          className='flex h-full items-center gap-1.5 px-3 font-medium text-stone-600 transition-colors hover:bg-stone-100/50 md:px-4'
          title={`${t('collapse')} ${t('all')}`}>
          <ChevronsDownUp className='size-4' />
          <span className='hidden text-sm sm:inline sm:text-sm'>
            {t('collapse')}
          </span>
        </button>
        <button
          onClick={() => setExpandSignal({ type: 'expand', ts: Date.now() })}
          className='flex h-full items-center gap-1.5 border-r border-stone-200/50 px-3 font-medium text-stone-600 transition-colors hover:bg-stone-100/50 md:px-4'
          title={`${t('expand')} ${t('all')}`}>
          <ChevronsUpDown className='size-4' />
          <span className='hidden text-sm sm:inline sm:text-sm'>
            {t('expand')}
          </span>
        </button>
      </div>
    </BaseToolbar>
  )
}
