'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useRef, useState } from 'react'

import {
  createIntakeLink,
  deleteIntakeLink,
  deleteIntakeSubmission,
  disableIntakeLink,
  getIntakeSubmissions,
  replaceLegacyIntakeLink,
  reviewIntakeSubmission
} from '@/app/actions/intake'
import config from '@/app/config'
import FamilyEditor from '@/components/intake/FamilyEditor'
import { basicInputClass } from '@/components/MemorialFields'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { intakeMessages } from '@/lib/i18n/intake'
import { Person } from '@/types'
import { IntakeLink, IntakePayload, IntakeSubmission } from '@/types/intake'

export default function IntakeManager({
  people,
  links
}: {
  people: Person[]
  links: IntakeLink[]
}) {
  const router = useRouter()
  const { locale } = useI18n()
  const text = intakeMessages[locale]
  const [title, setTitle] = useState('')
  const [root, setRoot] = useState('')
  const [days, setDays] = useState(90)
  const [checkedAt, setCheckedAt] = useState(() => Date.now())
  const [publicLink, setPublicLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [copiedId, setCopiedId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('pending')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<IntakeSubmission[]>([])
  const [count, setCount] = useState(0)
  const [selected, setSelected] = useState<IntakeSubmission | null>(null)
  const [reviewPayload, setReviewPayload] = useState<IntakePayload | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [refresh, setRefresh] = useState(0)
  const requestVersion = useRef(0)
  const reviewRef = useRef<HTMLElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const reviewNoteRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const timer = window.setInterval(() => setCheckedAt(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (error)
      errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])
  useEffect(() => {
    if (selected?.id)
      reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selected?.id])
  const errorText = (error: string) =>
    error === 'migration' ? text.migration : error

  useEffect(() => {
    let active = true
    const version = ++requestVersion.current
    // Keep the loading state and network request outside the synchronous effect body.
    Promise.resolve().then(async () => {
      if (!active) return
      setLoading(true)
      try {
        const result = await getIntakeSubmissions(status, page)
        if (!active || requestVersion.current !== version) return
        setRows(result.rows)
        setCount(result.count)
        if (result.error)
          setError(result.error === 'migration' ? text.migration : result.error)
      } catch {
        if (active) setError(text.error)
      } finally {
        if (active && requestVersion.current === version) setLoading(false)
      }
    })
    return () => {
      active = false
    }
  }, [status, page, refresh, text])

  async function createLink(event: FormEvent) {
    event.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)
    try {
      const result = await createIntakeLink(title, root, days)
      if (result.error) setError(errorText(result.error))
      else {
        setPublicLink(`${config.appUrl}/contribute/${result.token}`)
        setCopied(false)
        router.refresh()
      }
    } catch {
      setError(text.error)
    } finally {
      setBusy(false)
    }
  }
  async function disable(id: string) {
    setBusy(true)
    setError('')
    try {
      const result = await disableIntakeLink(id)
      if (result.error) setError(errorText(result.error))
      else {
        setPublicLink('')
        setCopiedId('')
        router.refresh()
      }
    } catch {
      setError(text.error)
    } finally {
      setBusy(false)
    }
  }
  async function manageLink(id: string, action: 'delete' | 'replace') {
    if (
      busy ||
      !window.confirm(
        action === 'delete' ? text.deleteConfirmation : text.replaceConfirmation
      )
    )
      return
    setBusy(true)
    setError('')
    try {
      const result =
        action === 'delete'
          ? await deleteIntakeLink(id)
          : await replaceLegacyIntakeLink(id)
      if (result.error) setError(errorText(result.error))
      else {
        setPublicLink(
          'token' in result && result.token
            ? `${config.appUrl}/contribute/${result.token}`
            : ''
        )
        setCopied(false)
        setCopiedId('')
        router.refresh()
      }
    } catch {
      setError(text.error)
    } finally {
      setBusy(false)
    }
  }
  async function copyLink(link: IntakeLink) {
    if (
      !link.share_token ||
      !link.is_active ||
      new Date(link.expires_at).getTime() <= checkedAt
    ) {
      setError(text.unavailable)
      router.refresh()
      return
    }
    const url = `${config.appUrl}/contribute/${link.share_token}`
    setPublicLink(url)
    setCopied(false)
    setCopiedId('')
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(link.id)
      setCopied(true)
    } catch {
      setError(text.copyFallback)
    }
  }
  async function review(decision: 'approved' | 'rejected' | 'needs_info') {
    if (!selected || !reviewPayload || busy) return
    if (decision !== 'approved' && !reviewNote.trim()) {
      setError(text.reviewNoteRequired)
      reviewNoteRef.current?.focus()
      return
    }
    if (decision === 'approved' && !window.confirm(text.confirmation)) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await reviewIntakeSubmission(
        selected.id,
        decision,
        reviewPayload,
        reviewNote
      )
      if (result.error) setError(`${text.invalidReview} ${result.error}`)
      else {
        setSelected(null)
        setReviewPayload(null)
        setRefresh((v) => v + 1)
        setMessage(text.saved)
        router.refresh()
      }
    } catch {
      setError(text.error)
    } finally {
      setBusy(false)
    }
  }

  async function deleteSubmission() {
    if (!selected || busy || !window.confirm(text.deleteSubmissionConfirmation))
      return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await deleteIntakeSubmission(selected.id)
      if (result.error) setError(errorText(result.error))
      else {
        setSelected(null)
        setReviewPayload(null)
        setPage(0)
        setRefresh((v) => v + 1)
        setMessage(text.submissionDeleted)
        router.refresh()
      }
    } catch {
      setError(text.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='space-y-6 text-sm'>
      {error && error !== text.reviewNoteRequired && (
        <p
          ref={errorRef}
          role='alert'
          className='rounded-xl border border-border bg-surface p-4 text-red-600'>
          {error}
        </p>
      )}
      {message && (
        <p role='status' className='text-secondary'>
          {message}
        </p>
      )}
      <section className='space-y-4 rounded-3xl border border-border bg-surface p-4 sm:p-6'>
        <h2 className='text-lg font-semibold'>{text.links}</h2>
        <form onSubmit={createLink} className='space-y-4'>
          <div className='grid gap-4 sm:grid-cols-2'>
            <label className='space-y-2 text-secondary'>
              <span>{text.linkTitle}</span>
              <input
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={basicInputClass}
              />
            </label>
            <label className='space-y-2 text-secondary'>
              <span>{text.root}</span>
              <select
                required
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                className={basicInputClass}>
                <option value=''>{text.select}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} — {text.generation} {p.generation ?? '?'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className='block space-y-2 text-secondary'>
            <span>{text.days}</span>
            <input
              type='number'
              min={1}
              max={365}
              required
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className={basicInputClass}
            />
          </label>
          <p className='text-secondary'>{text.expiresHint}</p>
          <button
            disabled={busy}
            className='rounded-xl bg-primary px-4 py-3 text-surface disabled:opacity-50'>
            {busy ? text.sending : text.createLink}
          </button>
        </form>
        {publicLink && (
          <div className='space-y-2 rounded-xl border border-border bg-neutral p-4'>
            <p className='font-medium'>{text.publicLink}</p>
            <input
              aria-label={text.publicLink}
              readOnly
              value={publicLink}
              className={basicInputClass}
              onFocus={(e) => e.target.select()}
            />
            <p className='text-secondary'>{text.keepLink}</p>
            <button
              type='button'
              className='rounded-xl border border-border px-4 py-2'
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(publicLink)
                  setCopied(true)
                } catch {
                  setCopied(false)
                  setError(text.copyFallback)
                }
              }}>
              {copied ? text.copied : text.copy}
            </button>
          </div>
        )}
        <ul className='space-y-2'>
          {links.map((link) => (
            <li
              key={link.id}
              className='flex flex-wrap items-center justify-between gap-2 border-b border-border py-3'>
              <div className='space-y-1'>
                <p className='font-medium'>{link.title}</p>
                <p className='text-secondary'>
                  {link.is_active &&
                  new Date(link.expires_at).getTime() > checkedAt &&
                  people.some((person) => person.id === link.root_person_id)
                    ? text.enabled
                    : text.disabled}{' '}
                  · {text.expiry}:{' '}
                  {new Date(link.expires_at).toLocaleDateString(locale, {
                    timeZone: 'Asia/Ho_Chi_Minh'
                  })}
                </p>
              </div>
              <div className='flex flex-wrap gap-2'>
                {link.is_active &&
                  new Date(link.expires_at).getTime() > checkedAt &&
                  people.some(
                    (person) => person.id === link.root_person_id
                  ) && (
                    <button
                      type='button'
                      disabled={busy}
                      onClick={() =>
                        link.share_token
                          ? copyLink(link)
                          : manageLink(link.id, 'replace')
                      }
                      className='rounded-xl border border-border px-4 py-2'>
                      {link.share_token
                        ? copiedId === link.id
                          ? text.copied
                          : text.copy
                        : text.replaceLink}
                    </button>
                  )}
                {link.is_active && (
                  <button
                    type='button'
                    disabled={busy}
                    onClick={() => disable(link.id)}
                    className='rounded-xl border border-border px-4 py-2'>
                    {text.disable}
                  </button>
                )}
                <button
                  type='button'
                  disabled={busy}
                  onClick={() => manageLink(link.id, 'delete')}
                  className='rounded-xl border border-border px-4 py-2 text-error'>
                  {text.deleteLink}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className='space-y-4'>
        <div className='flex flex-wrap items-center justify-between gap-4'>
          <h2 className='text-lg font-semibold'>
            {text.queue} ({count})
          </h2>
          <select
            aria-label={text.queue}
            disabled={busy}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(0)
              setSelected(null)
              setReviewPayload(null)
            }}
            className='rounded-xl border border-border bg-surface p-3 text-sm'>
            {(
              ['pending', 'needs_info', 'approved', 'rejected', 'all'] as const
            ).map((s) => (
              <option key={s} value={s}>
                {text[s]}
              </option>
            ))}
          </select>
        </div>
        {loading ? (
          <p className='text-secondary'>{text.sending}</p>
        ) : rows.length === 0 ? (
          <p className='text-secondary'>{text.empty}</p>
        ) : (
          <ul className='space-y-2'>
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type='button'
                  disabled={busy}
                  onClick={() => {
                    setSelected(row)
                    setReviewPayload(
                      structuredClone(row.reviewed_payload || row.payload)
                    )
                    setReviewNote(row.reviewer_note || '')
                    setError('')
                  }}
                  className='w-full space-y-2 rounded-xl border border-border bg-surface p-4 text-left'>
                  <span className='block font-medium'>
                    {row.payload.sender_name} · {row.payload.people.length}{' '}
                    {text.people.toLowerCase()}
                  </span>
                  <span className='block text-secondary'>
                    {text[row.status]} ·{' '}
                    {new Date(row.created_at).toLocaleString(locale)}
                  </span>
                  <span className='block text-secondary'>
                    {row.payload.people.map((p) => p.data.full_name).join(', ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className='flex justify-between gap-4'>
          <button
            type='button'
            disabled={page === 0 || loading || busy}
            onClick={() => setPage((p) => p - 1)}
            className='rounded-xl border border-border px-4 py-2 disabled:opacity-50'>
            {text.previous}
          </button>
          <button
            type='button'
            disabled={(page + 1) * 20 >= count || loading || busy}
            onClick={() => setPage((p) => p + 1)}
            className='rounded-xl border border-border px-4 py-2 disabled:opacity-50'>
            {text.next}
          </button>
        </div>
      </section>
      {selected && reviewPayload && (
        <section
          ref={reviewRef}
          className='space-y-4 rounded-3xl border border-border bg-neutral p-4 sm:p-6'>
          <h2 className='text-lg font-semibold'>
            {text.sender}: {selected.payload.sender_name}
          </h2>
          <p className='text-secondary'>
            {text.contact}: {selected.payload.sender_contact}
          </p>
          <p className='text-secondary'>
            {text.note}: {selected.payload.note || '—'}
          </p>
          <p className='text-secondary'>
            {text.receipt}: {selected.id}
          </p>
          {['pending', 'needs_info'].includes(selected.status) ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void review('approved')
              }}
              className='space-y-4'>
              <label className='block space-y-2 text-secondary'>
                <span>{text.anchor}</span>
                <select
                  required
                  value={reviewPayload.anchor_id}
                  onChange={(e) =>
                    setReviewPayload({
                      ...reviewPayload,
                      anchor_id: e.target.value
                    })
                  }
                  className={basicInputClass}>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} — {text.generation} {p.generation ?? '?'}
                    </option>
                  ))}
                </select>
              </label>
              <FamilyEditor
                key={selected.id}
                value={reviewPayload}
                onChange={setReviewPayload}
                anchorName={
                  people.find((p) => p.id === reviewPayload.anchor_id)
                    ?.full_name || text.anchor
                }
                existingPeople={people}
              />
              <label className='block space-y-2 text-secondary'>
                <span>{text.reviewerNote}</span>
                <textarea
                  ref={reviewNoteRef}
                  aria-invalid={error === text.reviewNoteRequired}
                  aria-describedby='intake-review-note-hint'
                  maxLength={2000}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  className={basicInputClass}
                />
                <span id='intake-review-note-hint' className='block'>
                  {text.reviewNoteHint}
                </span>
                {error === text.reviewNoteRequired && (
                  <span role='alert' className='block text-error'>
                    {error}
                  </span>
                )}
              </label>
              <p className='text-secondary'>{text.approvalHint}</p>
              <div className='flex flex-wrap gap-4'>
                <button
                  disabled={busy}
                  type='submit'
                  className='rounded-xl bg-primary px-4 py-3 text-surface disabled:opacity-50'>
                  {text.approve}
                </button>
                <button
                  type='button'
                  disabled={busy}
                  onClick={() => review('needs_info')}
                  className='rounded-xl border border-border bg-surface px-4 py-3'>
                  {text.requestInfo}
                </button>
                <button
                  type='button'
                  disabled={busy}
                  onClick={() => review('rejected')}
                  className='rounded-xl border border-border bg-surface px-4 py-3'>
                  {text.reject}
                </button>
                <button
                  type='button'
                  disabled={busy}
                  onClick={deleteSubmission}
                  className='rounded-xl border border-border bg-surface px-4 py-3 text-error'>
                  {text.deleteSubmission}
                </button>
              </div>
            </form>
          ) : (
            <div className='space-y-2 text-secondary'>
              <p>{text[selected.status]}</p>
              <p>
                {text.reviewerNote}: {selected.reviewer_note || '—'}
              </p>
              {(selected.reviewed_payload || selected.payload).people.map(
                (p, index) => (
                  <p key={p.client_id}>
                    {selected.approved_person_ids?.[index] ? (
                      <Link
                        className='text-amber-600 hover:underline'
                        href={`/dashboard/members/${selected.approved_person_ids[index]}`}>
                        {p.data.full_name}
                      </Link>
                    ) : (
                      p.data.full_name
                    )}
                  </p>
                )
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
