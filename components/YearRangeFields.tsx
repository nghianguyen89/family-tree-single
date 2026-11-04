'use client'

import { useId } from 'react'

import { useI18n } from '@/lib/i18n/I18nProvider'

export default function YearRangeFields({
  from,
  to,
  onFromChange,
  onToChange
}: {
  from: number | ''
  to: number | ''
  onFromChange: (value: number | '') => void
  onToChange: (value: number | '') => void
}) {
  const { t } = useI18n()
  const id = useId()
  return (
    <div className='space-y-2'>
      <div className='grid grid-cols-2 gap-4'>
        {(['from', 'to'] as const).map((bound) => (
          <div key={bound}>
            <label
              htmlFor={`${id}-${bound}`}
              className='mb-2 block text-sm font-medium text-stone-600'>
              {t(bound === 'from' ? 'fromYear' : 'toYear')}
            </label>
            <input
              id={`${id}-${bound}`}
              type='number'
              min={1}
              max={9999}
              step={1}
              required
              value={bound === 'from' ? from : to}
              onChange={(e) =>
                (bound === 'from' ? onFromChange : onToChange)(
                  e.target.value ? Number(e.target.value) : ''
                )
              }
              className='block w-full rounded-xl border border-stone-200 bg-surface px-4 py-3 text-sm text-stone-900 outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20'
            />
          </div>
        ))}
      </div>
      <p className='text-sm text-stone-600'>{t('yearRangeHint')}</p>
    </div>
  )
}
