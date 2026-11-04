'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { updateBranch } from '@/app/actions/branches'
import { basicInputClass } from '@/components/MemorialFields'
import { branchesMessages } from '@/lib/i18n/branches'
import { useI18n } from '@/lib/i18n/I18nProvider'
import type { BranchPersonOption, FamilyBranch } from '@/types/branches'

export default function BranchPrivacySettings({
  branch,
  partners
}: {
  branch: FamilyBranch
  partners: BranchPersonOption[]
}) {
  const { locale } = useI18n()
  const text = branchesMessages[locale]
  const router = useRouter()
  const [partner, setPartner] = useState(branch.partner_person_id || '')
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  function save() {
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await updateBranch(branch.id, {
          partner_person_id: partner || null
        })
        setMessage(result.error ? text.error : text.saved)
        if (!result.error) router.refresh()
      } catch {
        setMessage(text.error)
      }
    })
  }
  return (
    <section className='space-y-3 rounded-2xl border border-border bg-surface p-5 text-sm'>
      <h2 className='font-serif text-lg font-semibold'>{text.privacyTitle}</h2>
      <p className='text-secondary'>{text.privacyHint}</p>
      <label className='block space-y-2 text-secondary'>
        <span>{text.partner}</span>
        <select
          className={basicInputClass}
          value={partner}
          onChange={(event) => setPartner(event.target.value)}>
          <option value=''>{text.noPartner}</option>
          {partners.map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name}
              {person.birth_year ? ` (${person.birth_year})` : ''}
            </option>
          ))}
        </select>
      </label>
      <div className='flex flex-wrap items-center gap-4'>
        <button
          disabled={pending}
          onClick={save}
          className='rounded-xl bg-primary px-4 py-3 text-sm font-medium text-surface disabled:opacity-50'>
          {pending ? text.saving : text.save}
        </button>
        <Link href='/dashboard/users' className='text-secondary underline'>
          {text.privacyAccountSetup}
        </Link>
      </div>
      {message && (
        <p role='status' className='text-secondary'>
          {message}
        </p>
      )}
    </section>
  )
}
