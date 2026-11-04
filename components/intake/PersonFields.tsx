'use client'

import { useId, useState } from 'react'

import MemorialFields, { basicInputClass } from '@/components/MemorialFields'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { intakeMessages } from '@/lib/i18n/intake'
import { IntakePersonData } from '@/types/intake'
import { emptyMemorial } from '@/utils/memorial'

function DateFields({
  prefix,
  value,
  onChange
}: {
  prefix: 'birth' | 'death'
  value: IntakePersonData
  onChange: (patch: Partial<IntakePersonData>) => void
}) {
  const { locale } = useI18n()
  const text = intakeMessages[locale]
  const id = useId()
  const [calendar, setCalendar] = useState<'lunar' | 'solar'>(
    value.death_lunar_year != null ||
      value.death_lunar_month != null ||
      value.death_lunar_day != null
      ? 'lunar'
      : 'solar'
  )
  const lunar = prefix === 'death' && calendar === 'lunar'
  const actualPrefix = lunar ? 'death_lunar' : prefix
  const [range, setRange] = useState(
    value[`${prefix}_year_from`] != null || value[`${prefix}_year_to`] != null
  )
  const hasDate =
    value[`${actualPrefix}_year`] != null ||
    value[`${actualPrefix}_month`] != null ||
    value[`${actualPrefix}_day`] != null
  // A blank partial date is still editable; unknown is represented by empty fields.
  const mode = range ? 'range' : 'partial'
  const clear = {
    [`${prefix}_year`]: null,
    [`${prefix}_month`]: null,
    [`${prefix}_day`]: null,
    [`${prefix}_year_from`]: null,
    [`${prefix}_year_to`]: null,
    ...(prefix === 'death'
      ? {
          death_lunar_year: null,
          death_lunar_month: null,
          death_lunar_day: null
        }
      : {})
  }
  return (
    <fieldset className='space-y-2'>
      <legend className='mb-2 text-sm font-medium text-primary'>
        {text[prefix]}
      </legend>
      <div className='flex flex-wrap items-center gap-4 text-sm text-secondary'>
        <label className='flex items-center gap-2'>
          <input
            type='checkbox'
            checked={mode === 'range'}
            onChange={(e) => {
              setRange(e.target.checked)
              onChange(clear)
            }}
            className='accent-amber-600'
          />
          {text.range}
        </label>
        {hasDate && !range && (
          <button
            type='button'
            onClick={() => onChange(clear)}
            className='text-amber-600'>
            {text.unknown}
          </button>
        )}
        {prefix === 'death' && !range && (
          <label className='flex items-center gap-2'>
            {text.calendar}
            <select
              aria-label={text.calendar}
              className='rounded-md border border-border bg-surface p-2 text-sm'
              value={lunar ? 'lunar' : 'solar'}
              onChange={(e) => {
                setCalendar(e.target.value as 'solar' | 'lunar')
                // A calendar change must not reinterpret a solar date as a lunar one.
                onChange(clear)
              }}>
              <option value='solar'>{text.solar}</option>
              <option value='lunar'>{text.lunar}</option>
            </select>
          </label>
        )}
      </div>
      <div className={`grid gap-4 ${range ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {(range
          ? (['year_from', 'year_to'] as const)
          : (['day', 'month', 'year'] as const)
        ).map((field) => {
          const key =
            `${range ? prefix : actualPrefix}_${field}` as keyof IntakePersonData
          const label =
            field === 'year_from'
              ? text.from
              : field === 'year_to'
                ? text.to
                : text[field]
          return (
            <label
              key={key}
              htmlFor={`${id}-${key}`}
              className='space-y-2 text-sm text-secondary'>
              <span>{label}</span>
              <input
                id={`${id}-${key}`}
                type='number'
                min={1}
                max={
                  field === 'month'
                    ? 12
                    : field === 'day'
                      ? lunar
                        ? 30
                        : 31
                      : 9999
                }
                required={range}
                value={value[key] == null ? '' : String(value[key])}
                onChange={(e) =>
                  onChange({
                    [key]: e.target.value ? Number(e.target.value) : null
                  })
                }
                className={basicInputClass}
              />
            </label>
          )
        })}
      </div>
      <p className='text-sm text-secondary'>{text.dateHint}</p>
    </fieldset>
  )
}

export default function PersonFields({
  value,
  onChange
}: {
  value: IntakePersonData
  onChange: (value: IntakePersonData) => void
}) {
  const { locale } = useI18n()
  const text = intakeMessages[locale]
  const id = useId()
  const patch = (data: Partial<IntakePersonData>) =>
    onChange({ ...value, ...data })
  return (
    <div className='space-y-4'>
      <div className='grid gap-4 sm:grid-cols-2'>
        <label
          htmlFor={`${id}-name`}
          className='space-y-2 text-sm text-secondary'>
          <span>{text.name} *</span>
          <input
            id={`${id}-name`}
            value={value.full_name}
            maxLength={200}
            required
            onChange={(e) => patch({ full_name: e.target.value })}
            className={basicInputClass}
          />
        </label>
        <label
          htmlFor={`${id}-gender`}
          className='space-y-2 text-sm text-secondary'>
          <span>{text.gender}</span>
          <select
            id={`${id}-gender`}
            value={value.gender}
            onChange={(e) =>
              patch({ gender: e.target.value as IntakePersonData['gender'] })
            }
            className={basicInputClass}>
            <option value='male'>{text.male}</option>
            <option value='female'>{text.female}</option>
            <option value='other'>{text.other}</option>
          </select>
        </label>
      </div>
      <label
        htmlFor={`${id}-other`}
        className='block space-y-2 text-sm text-secondary'>
        <span>{text.otherNames}</span>
        <input
          id={`${id}-other`}
          value={value.other_names || ''}
          maxLength={2000}
          onChange={(e) => patch({ other_names: e.target.value || null })}
          className={basicInputClass}
        />
      </label>
      <DateFields prefix='birth' value={value} onChange={patch} />
      <label className='flex items-center gap-2 text-sm text-secondary'>
        <input
          type='checkbox'
          checked={value.is_deceased || false}
          onChange={(e) =>
            patch({
              is_deceased: e.target.checked,
              ...(!e.target.checked
                ? {
                    death_year: null,
                    death_month: null,
                    death_day: null,
                    death_year_from: null,
                    death_year_to: null,
                    death_lunar_year: null,
                    death_lunar_month: null,
                    death_lunar_day: null,
                    ...emptyMemorial()
                  }
                : {})
            })
          }
          className='accent-amber-600'
        />
        {text.deceased}
      </label>
      {value.is_deceased && (
        <>
          <DateFields prefix='death' value={value} onChange={patch} />
          <MemorialFields value={value} onChange={patch} />
        </>
      )}
      <label
        htmlFor={`${id}-note`}
        className='block space-y-2 text-sm text-secondary'>
        <span>{text.note}</span>
        <textarea
          id={`${id}-note`}
          value={value.note || ''}
          maxLength={2000}
          rows={2}
          onChange={(e) => patch({ note: e.target.value || null })}
          className={basicInputClass}
        />
      </label>
    </div>
  )
}
