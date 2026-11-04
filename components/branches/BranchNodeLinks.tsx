'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useId, useState, useTransition } from 'react'

import { getBranchTreePreview } from '@/app/actions/branches'
import { useMemberListView } from '@/context/MemberListContext'
import { branchesMessages } from '@/lib/i18n/branches'
import { useI18n } from '@/lib/i18n/I18nProvider'
import type { BranchTreePreview, FamilyBranch } from '@/types/branches'

const BranchInlineTree = dynamic(() => import('./BranchInlineTree'))

function BranchEntry({ branch }: { branch: FamilyBranch }) {
  const { locale } = useI18n()
  const text = branchesMessages[locale]
  const id = useId()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<BranchTreePreview | null>(null)
  const [error, setError] = useState(false)
  const [pending, startTransition] = useTransition()
  function toggle() {
    setOpen(!open)
    if (open || preview || pending) return
    setError(false)
    startTransition(async () => {
      try {
        const result = await getBranchTreePreview(branch.id)
        setPreview(result.preview)
        setError(!!result.error)
      } catch {
        setError(true)
      }
    })
  }
  return (
    <div
      className='text-left text-sm'
      onClick={(event) => event.stopPropagation()}>
      <button
        type='button'
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className='mt-2 inline-flex items-center gap-1 rounded-xl border border-tertiary bg-tertiary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-tertiary/20'>
        <span aria-hidden='true'>{open ? '−' : '+'}</span> {text.title} ·{' '}
        {branch.name}
      </button>
      {open && (
        <section
          id={id}
          aria-label={branch.name}
          className='mt-2 w-80 max-w-[calc(100vw-3rem)] space-y-3 rounded-xl border border-tertiary bg-neutral p-3'>
          <Link
            href={`/dashboard/branches/${branch.id}`}
            className='font-medium text-primary underline'>
            {text.open}
          </Link>
          {pending && (
            <p role='status' className='text-secondary'>
              {text.loadingTree}
            </p>
          )}
          {error && (
            <p role='alert' className='text-error'>
              {text.unavailable}
            </p>
          )}
          {preview && <BranchInlineTree preview={preview} />}
        </section>
      )}
    </div>
  )
}

export default function BranchNodeLinks({ personId }: { personId: string }) {
  const { branches } = useMemberListView()
  // Metadata is supplied by the server under RLS. Do not reveal hidden branches.
  return branches
    .filter((branch) => branch.anchor_person_id === personId)
    .map((branch) => <BranchEntry key={branch.id} branch={branch} />)
}
