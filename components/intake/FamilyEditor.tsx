'use client'

import PersonFields from '@/components/intake/PersonFields'
import { basicInputClass } from '@/components/MemorialFields'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { intakeMessages } from '@/lib/i18n/intake'
import { Person } from '@/types'
import { IntakePayload, IntakePerson } from '@/types/intake'
import { formatDisplayDate } from '@/utils/dateHelpers'
import { formatMemorial } from '@/utils/memorial'

export function newIntakePerson(relativeTo = 'anchor'): IntakePerson {
  return {
    client_id: crypto.randomUUID(),
    relation: 'child',
    relative_to: relativeTo,
    data: { full_name: '', gender: 'male', is_deceased: false }
  }
}

export default function FamilyEditor({
  value,
  onChange,
  anchorName,
  existingPeople
}: {
  value: IntakePayload
  onChange: (value: IntakePayload) => void
  anchorName: string
  existingPeople?: Person[]
}) {
  const { locale } = useI18n()
  const text = intakeMessages[locale]
  const update = (index: number, patch: Partial<IntakePerson>) =>
    onChange({
      ...value,
      people: value.people.map((p, i) => (i === index ? { ...p, ...patch } : p))
    })
  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-4'>
        <h2 className='text-lg font-semibold'>
          {text.people} ({value.people.length})
        </h2>
      </div>
      {value.people.map((person, index) => {
        const relatives = [
          { id: 'anchor', name: anchorName },
          ...value.people.slice(0, index).map((p, i) => ({
            id: p.client_id,
            name: p.data.full_name || `${text.people} ${i + 1}`
          }))
        ]
        const matched = existingPeople?.find(
          (p) =>
            p.id ===
            (person.relation === 'self'
              ? value.anchor_id
              : person.existing_person_id)
        )
        const duplicates =
          existingPeople?.filter(
            (p) =>
              p.full_name.trim().toLocaleLowerCase() ===
              person.data.full_name.trim().toLocaleLowerCase()
          ) || []
        return (
          <section
            key={person.client_id}
            className='space-y-4 rounded-3xl border border-border bg-surface p-4 sm:p-6'>
            <h3 className='text-base font-semibold'>
              {index + 1}. {person.data.full_name || text.people}
            </h3>
            <div className='grid gap-4 sm:grid-cols-2'>
              <label className='space-y-2 text-sm text-secondary'>
                <span>{text.relationship}</span>
                <select
                  value={person.relation}
                  onChange={(e) =>
                    update(index, {
                      relation: e.target.value as IntakePerson['relation'],
                      relative_to:
                        e.target.value === 'self'
                          ? 'anchor'
                          : person.relative_to,
                      other_parent_ref: null,
                      existing_person_id: null,
                      update_existing: false
                    })
                  }
                  className={basicInputClass}>
                  <option value='child'>{text.child}</option>
                  <option value='spouse'>{text.spouse}</option>
                  <option value='self'>{text.self}</option>
                </select>
              </label>
              <label className='space-y-2 text-sm text-secondary'>
                <span>{text.relative}</span>
                <select
                  disabled={person.relation === 'self'}
                  value={person.relative_to}
                  onChange={(e) =>
                    update(index, {
                      relative_to: e.target.value,
                      other_parent_ref: null
                    })
                  }
                  className={basicInputClass}>
                  {relatives.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {person.relation === 'child' && (
              <label className='block space-y-2 text-sm text-secondary'>
                <span>{text.secondParent}</span>
                <select
                  value={person.other_parent_ref || ''}
                  onChange={(e) =>
                    update(index, { other_parent_ref: e.target.value || null })
                  }
                  className={basicInputClass}>
                  <option value=''>{text.none}</option>
                  {relatives
                    .filter((r) => r.id !== person.relative_to)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {existingPeople && (
              <div className='space-y-4 rounded-xl border border-border bg-neutral p-4 text-sm'>
                <label className='block space-y-2 text-secondary'>
                  <span>{text.match}</span>
                  <select
                    disabled={person.relation === 'self'}
                    value={
                      person.relation === 'self'
                        ? value.anchor_id
                        : person.existing_person_id || ''
                    }
                    onChange={(e) =>
                      update(index, {
                        existing_person_id: e.target.value || null,
                        update_existing: false,
                        confirm_new: false
                      })
                    }
                    className={basicInputClass}>
                    <option value=''>{text.newPerson}</option>
                    {existingPeople.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name} — {text.generation} {p.generation ?? '?'}
                      </option>
                    ))}
                  </select>
                </label>
                {matched ? (
                  <>
                    <details className='text-secondary'>
                      <summary className='cursor-pointer'>
                        {text.existingInfo}: {matched.full_name}
                      </summary>
                      <div className='mt-2 space-y-2'>
                        <p>
                          {text.birth}:{' '}
                          {formatDisplayDate(
                            matched.birth_year,
                            matched.birth_month,
                            matched.birth_day,
                            matched.birth_year_from,
                            matched.birth_year_to
                          )}
                        </p>
                        <p>
                          {text.death}:{' '}
                          {formatDisplayDate(
                            matched.death_year,
                            matched.death_month,
                            matched.death_day,
                            matched.death_year_from,
                            matched.death_year_to
                          )}
                        </p>
                        <p>
                          {text.knownDate}:{' '}
                          {formatMemorial(matched) || text.noMemorial}
                        </p>
                        <p>
                          {text.note}: {matched.note || '—'}
                        </p>
                      </div>
                    </details>
                    <label className='flex items-start gap-2 text-secondary'>
                      <input
                        type='checkbox'
                        checked={person.update_existing || false}
                        onChange={(e) =>
                          update(index, { update_existing: e.target.checked })
                        }
                        className='mt-1 accent-amber-600'
                      />
                      {text.updateExisting}
                    </label>
                  </>
                ) : (
                  duplicates.length > 0 && (
                    <div className='space-y-2 text-secondary'>
                      <p>{text.duplicate}</p>
                      <label className='flex items-start gap-2'>
                        <input
                          type='checkbox'
                          checked={person.confirm_new || false}
                          onChange={(e) =>
                            update(index, { confirm_new: e.target.checked })
                          }
                          className='mt-1 accent-amber-600'
                        />
                        {text.confirmNew}
                      </label>
                    </div>
                  )
                )}
              </div>
            )}
            {existingPeople && !matched && person.relation !== 'self' && (
              <label className='block space-y-2 text-sm text-secondary'>
                <span>{text.generation}</span>
                <input
                  type='number'
                  min={1}
                  max={10000}
                  value={person.generation ?? ''}
                  onChange={(e) =>
                    update(index, {
                      generation: e.target.value ? Number(e.target.value) : null
                    })
                  }
                  className={basicInputClass}
                />
                <span className='block'>{text.generationHint}</span>
              </label>
            )}
            <PersonFields
              value={person.data}
              onChange={(data) => update(index, { data })}
            />
          </section>
        )
      })}
      <div className='flex flex-wrap gap-2'>
        <button
          type='button'
          disabled={value.people.length >= 30}
          className='rounded-xl border border-border bg-surface px-4 py-2 text-sm disabled:opacity-50'
          onClick={() =>
            onChange({
              ...value,
              people: [
                ...value.people,
                newIntakePerson(value.people[0]?.client_id)
              ]
            })
          }>
          {text.add}
        </button>
        <button
          type='button'
          disabled={value.people.length <= 1}
          className='rounded-xl border border-border px-4 py-2 text-sm disabled:opacity-50'
          onClick={() =>
            onChange({ ...value, people: value.people.slice(0, -1) })
          }>
          {text.remove}
        </button>
      </div>
      <p className='text-sm text-secondary'>{text.generationHint}</p>
    </div>
  )
}
