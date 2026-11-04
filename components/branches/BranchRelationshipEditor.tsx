'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'

import {
  addBranchPerson,
  getBranchRelationshipPeople
} from '@/app/actions/branches'
import { basicInputClass } from '@/components/MemorialFields'
import { branchesMessages } from '@/lib/i18n/branches'
import { useI18n } from '@/lib/i18n/I18nProvider'
import type { BranchPersonOption, BranchRelation } from '@/types/branches'

export default function BranchRelationshipEditor({
  branchId,
  persons,
  initialPersonId,
  onSaved
}: {
  branchId: string
  persons?: BranchPersonOption[]
  initialPersonId: string
  onSaved?: () => void
}) {
  const { locale } = useI18n()
  const text = branchesMessages[locale]
  const router = useRouter()
  const [loadedPeople, setLoadedPeople] = useState<BranchPersonOption[]>([])
  const [loading, setLoading] = useState(!persons)
  const [sourceId, setSourceId] = useState(initialPersonId)
  const [relativeId, setRelativeId] = useState('')
  const [relation, setRelation] =
    useState<Exclude<BranchRelation, 'member'>>('spouse')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()
  const people = persons ?? loadedPeople
  const selectedSourceId = people.some((person) => person.id === sourceId)
    ? sourceId
    : ''

  useEffect(() => {
    if (persons) return
    let live = true
    getBranchRelationshipPeople(branchId)
      .then((result) => {
        if (!live) return
        setLoadedPeople(result.people)
        setError(result.error)
        setLoading(false)
      })
      .catch(() => {
        if (live) {
          setError('error')
          setLoading(false)
        }
      })
    return () => {
      live = false
    }
  }, [branchId, persons])

  function save(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedSourceId || !relativeId || selectedSourceId === relativeId)
      return
    setError(null)
    setSaved(false)
    startTransition(async () => {
      try {
        const result = await addBranchPerson({
          branchId,
          existingPersonId: selectedSourceId,
          relativeId,
          relation
        })
        if (result.error) {
          setError(result.error)
          return
        }
        setSaved(true)
        onSaved?.()
        router.refresh()
      } catch {
        setError('error')
      }
    })
  }
  return (
    <form onSubmit={save} className='space-y-3 text-sm'>
      <h3 className='text-base font-semibold text-primary'>
        {text.addRelationship}
      </h3>
      <p className='text-secondary'>{text.relationshipHint}</p>
      {loading ? (
        <p className='text-secondary'>…</p>
      ) : people.length < 2 ? (
        <p className='text-secondary'>{text.relationshipNeedsPeople}</p>
      ) : (
        <>
          <div className='grid gap-3 sm:grid-cols-3'>
            <label className='space-y-2 text-secondary'>
              <span>{text.relationshipSubject}</span>
              <select
                required
                className={basicInputClass}
                value={selectedSourceId}
                disabled={pending}
                onChange={(event) => {
                  setSourceId(event.target.value)
                  setRelativeId('')
                  setSaved(false)
                }}>
                <option value=''>{text.relationshipSubject}</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className='space-y-2 text-secondary'>
              <span>{text.relation}</span>
              <select
                className={basicInputClass}
                value={relation}
                disabled={pending}
                onChange={(event) => {
                  setRelation(event.target.value as typeof relation)
                  setSaved(false)
                }}>
                {(['spouse', 'parent', 'child'] as const).map((value) => (
                  <option key={value} value={value}>
                    {text[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className='space-y-2 text-secondary'>
              <span>{text.relative}</span>
              <select
                required
                className={basicInputClass}
                value={relativeId}
                disabled={pending}
                onChange={(event) => {
                  setRelativeId(event.target.value)
                  setSaved(false)
                }}>
                <option value=''>{text.selectRelative}</option>
                {people
                  .filter((person) => person.id !== selectedSourceId)
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.full_name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <button
            type='submit'
            disabled={
              pending ||
              !selectedSourceId ||
              !relativeId ||
              selectedSourceId === relativeId
            }
            className='rounded-xl bg-primary px-4 py-3 text-sm font-medium text-surface disabled:opacity-50'>
            {pending ? text.saving : text.save}
          </button>
        </>
      )}
      {error && (
        <p role='alert' className='text-error'>
          {error === 'permission'
            ? text.editPermission
            : error === 'migration'
              ? text.migration
              : error === 'invalid'
                ? text.invalid
                : error === 'error'
                  ? text.error
                  : error}
        </p>
      )}
      {saved && (
        <p role='status' className='text-secondary'>
          {text.relationshipSaved}
        </p>
      )}
    </form>
  )
}
