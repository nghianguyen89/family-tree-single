'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'

import FamilyEditor from '@/components/intake/FamilyEditor'
import { basicInputClass } from '@/components/MemorialFields'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { intakeMessages } from '@/lib/i18n/intake'
import { IntakeOptions, IntakePayload } from '@/types/intake'
import { formatDisplayDate } from '@/utils/dateHelpers'
import { validateIntake } from '@/utils/intake'
import { formatMemorial } from '@/utils/memorial'

export default function PublicIntakeForm({
  token,
  options
}: {
  token: string
  options: IntakeOptions
}) {
  const { locale } = useI18n()
  const text = intakeMessages[locale]
  const [payload, setPayload] = useState<IntakePayload>({
    anchor_id: options.root_id,
    sender_name: '',
    sender_contact: '',
    note: '',
    people: [
      {
        client_id: '00000000-0000-4000-8000-000000000001',
        relation: 'child',
        relative_to: 'anchor',
        data: { full_name: '', gender: 'male', is_deceased: false }
      }
    ]
  })
  const [generation, setGeneration] = useState('all')
  const [preview, setPreview] = useState(false)
  const [consent, setConsent] = useState(false)
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState('')
  const errorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (error)
      errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])
  const anchor = options.people.find((p) => p.id === payload.anchor_id)
  const generations = [
    ...new Set(options.people.map((p) => p.generation))
  ].sort((a, b) => (a ?? 9999) - (b ?? 9999))
  const visiblePeople = options.people.filter(
    (p) =>
      generation === 'all' ||
      (p.generation == null ? 'unknown' : String(p.generation)) === generation
  )

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!validateIntake(payload)) {
      setError(text.invalid)
      return
    }
    if (!preview) {
      setPreview(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    if (!consent || busy) return
    setBusy(true)
    try {
      const response = await fetch(`/api/intake/${token}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': locale
        },
        body: JSON.stringify({ payload, consent, website })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || text.error)
      setReceipt(String(result.receipt))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      setError((error as Error).message || text.error)
    } finally {
      setBusy(false)
    }
  }

  if (receipt)
    return (
      <div
        role='status'
        className='space-y-4 rounded-3xl border border-border bg-surface p-6 text-sm'>
        <h2 className='text-xl font-semibold'>{text.success}</h2>
        <p className='text-secondary'>{text.notPublished}</p>
        <p className='break-all text-secondary'>
          {text.receipt}:{' '}
          <span className='font-medium text-primary'>{receipt}</span>
        </p>
      </div>
    )

  return (
    <form onSubmit={submit} className='space-y-6 text-sm'>
      <section className='space-y-4 rounded-3xl border border-border bg-surface p-4 sm:p-6'>
        <h2 className='text-lg font-semibold'>{options.title}</h2>
        <p className='text-secondary'>{text.publicNotice}</p>
        {error && (
          <p ref={errorRef} role='alert' className='text-red-600'>
            {error}
          </p>
        )}
        {!preview ? (
          <>
            <label className='block space-y-2 text-secondary'>
              <span>{text.generation}</span>
              <select
                value={generation}
                onChange={(e) => {
                  const selected = e.target.value
                  setGeneration(selected)
                  if (
                    selected !== 'all' &&
                    (anchor?.generation == null
                      ? 'unknown'
                      : String(anchor.generation)) !== selected
                  )
                    setPayload({ ...payload, anchor_id: '' })
                }}
                className={basicInputClass}>
                <option value='all'>{text.allGenerations}</option>
                {generations.map((g) => (
                  <option key={g ?? 'unknown'} value={g ?? 'unknown'}>
                    {g == null
                      ? text.unknownGeneration
                      : `${text.generation} ${g}`}
                  </option>
                ))}
              </select>
            </label>
            <label className='block space-y-2 text-secondary'>
              <span>{text.anchor} *</span>
              <select
                required
                value={payload.anchor_id}
                onChange={(e) =>
                  setPayload({ ...payload, anchor_id: e.target.value })
                }
                className={basicInputClass}>
                <option value=''>{text.select}</option>
                {visiblePeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} — {text.generation} {p.generation ?? '?'}
                  </option>
                ))}
              </select>
            </label>
            <div className='grid gap-4 sm:grid-cols-2'>
              <label className='space-y-2 text-secondary'>
                <span>{text.sender} *</span>
                <input
                  required
                  maxLength={200}
                  value={payload.sender_name}
                  onChange={(e) =>
                    setPayload({ ...payload, sender_name: e.target.value })
                  }
                  className={basicInputClass}
                />
              </label>
              <label className='space-y-2 text-secondary'>
                <span>{text.contact} *</span>
                <input
                  required
                  maxLength={200}
                  value={payload.sender_contact}
                  onChange={(e) =>
                    setPayload({ ...payload, sender_contact: e.target.value })
                  }
                  className={basicInputClass}
                />
              </label>
            </div>
            <p className='text-secondary'>{text.contactHint}</p>
          </>
        ) : (
          <div className='space-y-2 text-secondary'>
            <p>
              {text.anchor}: {anchor?.full_name}
            </p>
            <p>
              {text.sender}: {payload.sender_name}
            </p>
            <p>
              {text.contact}: {payload.sender_contact}
            </p>
            <p>
              {text.peopleCount}: {payload.people.length}
            </p>
          </div>
        )}
      </section>
      <div aria-hidden='true' className='hidden'>
        <label>
          {text.website}
          <input
            tabIndex={-1}
            autoComplete='off'
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>
      {!preview ? (
        <>
          <FamilyEditor
            value={payload}
            onChange={setPayload}
            anchorName={anchor?.full_name || text.anchor}
          />
          <label className='block space-y-2 text-secondary'>
            <span>{text.note}</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={payload.note}
              onChange={(e) => setPayload({ ...payload, note: e.target.value })}
              className={basicInputClass}
            />
          </label>
        </>
      ) : (
        <section className='space-y-4 rounded-3xl border border-border bg-surface p-4 sm:p-6'>
          <h2 className='text-lg font-semibold'>{text.review}</h2>
          {payload.people.map((p, i) => {
            const relative =
              p.relative_to === 'anchor'
                ? anchor?.full_name
                : payload.people.find((row) => row.client_id === p.relative_to)
                    ?.data.full_name
            const second =
              p.other_parent_ref === 'anchor'
                ? anchor?.full_name
                : payload.people.find(
                    (row) => row.client_id === p.other_parent_ref
                  )?.data.full_name
            return (
              <div
                key={p.client_id}
                className='space-y-2 border-b border-border pb-4 text-secondary'>
                <h3 className='text-base font-semibold text-primary'>
                  {i + 1}. {p.data.full_name}
                </h3>
                <p>
                  {text.gender}:{' '}
                  {text[p.data.gender === 'other' ? 'other' : p.data.gender]}
                </p>
                {p.data.other_names && (
                  <p>
                    {text.otherNames}: {p.data.other_names}
                  </p>
                )}
                <p>
                  {text[p.relation]}: {relative}
                </p>
                {second && (
                  <p>
                    {text.secondParent}: {second}
                  </p>
                )}
                <p>
                  {text.birth}:{' '}
                  {formatDisplayDate(
                    p.data.birth_year ?? null,
                    p.data.birth_month ?? null,
                    p.data.birth_day ?? null,
                    p.data.birth_year_from,
                    p.data.birth_year_to
                  )}
                </p>
                {p.data.is_deceased && (
                  <>
                    <p>
                      {text.death}:{' '}
                      {p.data.death_lunar_month ||
                      p.data.death_lunar_year ||
                      p.data.death_lunar_day
                        ? `${formatDisplayDate(p.data.death_lunar_year ?? null, p.data.death_lunar_month ?? null, p.data.death_lunar_day ?? null)} ${text.lunar}`
                        : formatDisplayDate(
                            p.data.death_year ?? null,
                            p.data.death_month ?? null,
                            p.data.death_day ?? null,
                            p.data.death_year_from,
                            p.data.death_year_to
                          )}
                    </p>
                    <p>
                      {text.knownDate}:{' '}
                      {formatMemorial(p.data) || text.noMemorial}
                    </p>
                    {p.data.memorial_note && (
                      <p>
                        {text.memorialNote}: {p.data.memorial_note}
                      </p>
                    )}
                  </>
                )}
                {p.data.note && (
                  <p>
                    {text.note}: {p.data.note}
                  </p>
                )}
              </div>
            )
          })}
          {payload.note && (
            <p className='text-secondary'>
              {text.note}: {payload.note}
            </p>
          )}
        </section>
      )}
      {preview && (
        <label className='flex items-start gap-2 text-secondary'>
          <input
            type='checkbox'
            required
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className='mt-1 accent-amber-600'
          />
          {text.consent}
        </label>
      )}
      <div className='flex flex-wrap gap-4'>
        {preview && (
          <button
            type='button'
            disabled={busy}
            onClick={() => {
              setPreview(false)
              setError('')
            }}
            className='rounded-xl border border-border bg-surface px-4 py-3'>
            {text.edit}
          </button>
        )}
        <button
          disabled={busy}
          type='submit'
          className='rounded-xl bg-primary px-6 py-3 font-medium text-surface disabled:opacity-50'>
          {busy ? text.sending : preview ? text.send : text.review}
        </button>
      </div>
      <p className='text-secondary'>{text.notPublished}</p>
    </form>
  )
}
