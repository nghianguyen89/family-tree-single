'use client'

import { useId } from 'react'

import { useI18n } from '@/lib/i18n/I18nProvider'
import { intakeMessages } from '@/lib/i18n/intake'
import { MemorialDate } from '@/types/intake'
import { emptyMemorial } from '@/utils/memorial'

export const basicInputClass =
  'block w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm text-primary outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 disabled:bg-neutral'

export default function MemorialFields({
  value,
  onChange
}: {
  value: MemorialDate
  onChange: (value: MemorialDate) => void
}) {
  const { locale } = useI18n()
  const text = intakeMessages[locale]
  const id = useId()
  const enabled = value.memorial_calendar != null
  return (
    <fieldset className='space-y-4 rounded-xl border border-border bg-neutral p-4 text-sm'>
      <label className='flex items-center gap-2 text-secondary'>
        <input
          type='checkbox'
          checked={enabled}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? { ...emptyMemorial(), memorial_calendar: 'lunar' }
                : emptyMemorial()
            )
          }
          className='accent-amber-600'
        />
        {text.memorial}
      </label>
      <p className='text-secondary'>{text.memorialHint}</p>
      {enabled && (
        <>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
            <label
              htmlFor={`${id}-calendar`}
              className='space-y-2 text-secondary'>
              <span>{text.calendar}</span>
              <select
                id={`${id}-calendar`}
                value={value.memorial_calendar || 'lunar'}
                onChange={(e) =>
                  onChange({
                    ...value,
                    memorial_calendar: e.target.value as 'solar' | 'lunar',
                    memorial_is_leap_month: false
                  })
                }
                className={basicInputClass}>
                <option value='lunar'>{text.lunar}</option>
                <option value='solar'>{text.solar}</option>
              </select>
            </label>
            {(['day', 'month'] as const).map((field) => (
              <label
                key={field}
                htmlFor={`${id}-${field}`}
                className='space-y-2 text-secondary'>
                <span>{text[field]}</span>
                <input
                  id={`${id}-${field}`}
                  type='number'
                  required
                  min={1}
                  max={
                    field === 'month'
                      ? 12
                      : value.memorial_calendar === 'lunar'
                        ? 30
                        : 31
                  }
                  value={value[`memorial_${field}`] ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      [`memorial_${field}`]: e.target.value
                        ? Number(e.target.value)
                        : null
                    })
                  }
                  className={basicInputClass}
                />
              </label>
            ))}
          </div>
          {value.memorial_calendar === 'lunar' && (
            <div className='space-y-2'>
              <label className='flex items-center gap-2 text-secondary'>
                <input
                  type='checkbox'
                  checked={value.memorial_is_leap_month || false}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      memorial_is_leap_month: e.target.checked
                    })
                  }
                  className='accent-amber-600'
                />
                {text.leap}
              </label>
              <p className='text-secondary'>{text.leapHint}</p>
            </div>
          )}
          <label
            htmlFor={`${id}-note`}
            className='block space-y-2 text-secondary'>
            <span>{text.memorialNote}</span>
            <input
              id={`${id}-note`}
              maxLength={1000}
              value={value.memorial_note || ''}
              onChange={(e) =>
                onChange({ ...value, memorial_note: e.target.value || null })
              }
              className={basicInputClass}
            />
          </label>
        </>
      )}
    </fieldset>
  )
}
