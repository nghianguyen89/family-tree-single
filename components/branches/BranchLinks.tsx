'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'

import { createBranch, getPersonBranches } from '@/app/actions/branches'
import BranchRelationshipEditor from '@/components/branches/BranchRelationshipEditor'
import { basicInputClass } from '@/components/MemorialFields'
import { branchesMessages } from '@/lib/i18n/branches'
import { useI18n } from '@/lib/i18n/I18nProvider'
import type { Person } from '@/types'
import type { FamilyBranch } from '@/types/branches'

export default function BranchLinks({
  person,
  canEdit,
  onRelationshipsChange
}: {
  person: Person
  canEdit: boolean
  onRelationshipsChange?: () => void
}) {
  const { locale } = useI18n()
  const text = branchesMessages[locale]
  const router = useRouter()
  const [branches, setBranches] = useState<FamilyBranch[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [canCreate, setCanCreate] = useState(false)
  const [editableBranchIds, setEditableBranchIds] = useState<string[]>([])
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let live = true
    getPersonBranches(person.id)
      .then((result) => {
        if (!live) return
        setBranches(result.branches)
        setError(result.error || null)
        setCanCreate(result.canCreate === true)
        setEditableBranchIds(result.editableBranchIds ?? [])
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
  }, [person.id])

  function create() {
    startTransition(async () => {
      try {
        const result = await createBranch(person.id, name)
        if ('error' in result && result.error) {
          setError(result.error)
          return
        }
        if ('id' in result && result.id)
          router.push(`/dashboard/branches/${result.id}`)
      } catch {
        setError('error')
      }
    })
  }

  const message =
    error === 'migration'
      ? text.migration
      : error === 'permission'
        ? text.permission
        : error === 'invalid'
          ? text.invalid
          : error
            ? text.error
            : null

  if (
    !loading &&
    branches.length === 0 &&
    !message &&
    !(canEdit && canCreate && person.is_in_law)
  )
    return null
  return (
    <section className='space-y-3 rounded-xl border border-border bg-surface p-4 text-sm'>
      <h3 className='font-serif text-lg font-semibold text-primary'>
        {text.title}
      </h3>
      {loading && <p className='text-secondary'>…</p>}
      {message && (
        <p role='alert' className='text-error'>
          {message}
        </p>
      )}
      {branches.length > 0 && (
        <ul className='space-y-2'>
          {branches.map((branch) => (
            <li key={branch.id}>
              <Link
                className='text-amber-700 underline-offset-2 hover:underline'
                href={`/dashboard/branches/${branch.id}`}>
                {branch.name} · {text.open}
              </Link>
              {canEdit && editableBranchIds.includes(branch.id) && (
                <details className='mt-2 rounded-xl border border-border p-3'>
                  <summary className='cursor-pointer font-medium text-primary'>
                    {text.addRelationship}
                  </summary>
                  <div className='mt-3'>
                    <BranchRelationshipEditor
                      branchId={branch.id}
                      initialPersonId={person.id}
                      onSaved={onRelationshipsChange}
                    />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && canCreate && person.is_in_law && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            create()
          }}
          className='flex flex-col gap-2 sm:flex-row sm:items-end'>
          <label className='flex-1 space-y-1 text-secondary'>
            <span>{text.name}</span>
            <input
              className={basicInputClass}
              maxLength={150}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button
            disabled={pending || !name.trim()}
            className='rounded-xl bg-primary px-4 py-3 text-sm font-medium text-surface disabled:opacity-50'>
            {pending ? text.saving : text.create}
          </button>
        </form>
      )}
    </section>
  )
}
