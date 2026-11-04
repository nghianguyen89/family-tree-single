'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'

import {
  addBranchPerson,
  removeBranchRelationship,
  searchBranchPeople,
  updateBranch,
  updateBranchMemberGeneration
} from '@/app/actions/branches'
import BranchPrivacySettings from '@/components/branches/BranchPrivacySettings'
import BranchRelationshipEditor from '@/components/branches/BranchRelationshipEditor'
import PersonFields from '@/components/intake/PersonFields'
import MembersViews from '@/components/MembersViews'
import { basicInputClass } from '@/components/MemorialFields'
import MemberDetailModal from '@/components/modal/MemberDetailModal'
import ViewToggle, { type ViewMode } from '@/components/ViewToggle'
import { MemberListProvider } from '@/context/MemberListContext'
import { branchesMessages } from '@/lib/i18n/branches'
import { useI18n } from '@/lib/i18n/I18nProvider'
import type { Person, Relationship } from '@/types'
import type {
  BranchPersonOption,
  BranchPersonPayload,
  BranchRelation,
  FamilyBranch,
  FamilyBranchMember
} from '@/types/branches'

const emptyPerson = (): BranchPersonPayload => ({
  full_name: '',
  gender: 'male',
  is_deceased: false,
  birth_year: null,
  birth_month: null,
  birth_day: null,
  birth_year_from: null,
  birth_year_to: null,
  death_year: null,
  death_month: null,
  death_day: null,
  death_year_from: null,
  death_year_to: null,
  death_lunar_year: null,
  death_lunar_month: null,
  death_lunar_day: null,
  memorial_day: null,
  memorial_month: null,
  memorial_calendar: null,
  memorial_is_leap_month: false,
  memorial_note: null,
  other_names: null,
  note: null
})

function messageFor(
  error: string | null,
  text: typeof branchesMessages.vi | typeof branchesMessages.en
) {
  if (!error) return null
  if (error === 'migration') return text.migration
  if (error === 'permission') return text.editPermission
  if (error === 'invalid') return text.invalid
  return error === 'error' ? text.error : error
}

export default function BranchWorkspace({
  branch,
  persons,
  relationships,
  members,
  canEdit,
  isAdmin = false,
  partnerOptions = [],
  initialRootId,
  initialView,
  initialShowAvatar
}: {
  branch: FamilyBranch
  persons: Person[]
  relationships: Relationship[]
  members: FamilyBranchMember[]
  canEdit: boolean
  isAdmin?: boolean
  partnerOptions?: BranchPersonOption[]
  initialRootId: string | null
  initialView?: string
  initialShowAvatar: boolean
}) {
  const { locale } = useI18n()
  const text = branchesMessages[locale]
  const router = useRouter()
  const [name, setName] = useState(branch.name)
  const [root, setRoot] = useState(
    branch.root_person_id || branch.anchor_person_id
  )
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [payload, setPayload] = useState<BranchPersonPayload>(emptyPerson)
  const [relation, setRelation] = useState<BranchRelation>('member')
  const [relativeId, setRelativeId] = useState(branch.anchor_person_id)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<BranchPersonOption[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [generationPersonId, setGenerationPersonId] = useState(
    branch.anchor_person_id
  )
  const [generation, setGeneration] = useState(
    String(
      members.find((member) => member.person_id === branch.anchor_person_id)
        ?.generation ?? ''
    )
  )
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (mode !== 'existing' || search.trim().length < 2) return
    let live = true
    const timer = setTimeout(() => {
      searchBranchPeople(branch.id, search)
        .then((result) => {
          if (!live) return
          setResults(result.people)
          setError(result.error)
        })
        .catch(() => {
          if (live) setError('error')
        })
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [branch.id, mode, search])

  function saveBranch() {
    setError(null)
    setStatus(null)
    startTransition(async () => {
      try {
        const result = await updateBranch(branch.id, {
          name,
          root_person_id: root
        })
        if (result.error) {
          setError(result.error)
          return
        }
        setStatus(text.saved)
        if (root !== branch.root_person_id) {
          const url = new URL(window.location.href)
          url.searchParams.set('rootId', root)
          router.push(url.pathname + url.search)
        }
        router.refresh()
      } catch {
        setError('error')
      }
    })
  }

  function addPerson() {
    setError(null)
    setStatus(null)
    startTransition(async () => {
      try {
        const result = await addBranchPerson({
          branchId: branch.id,
          payload: mode === 'new' ? payload : undefined,
          existingPersonId: mode === 'existing' ? selectedId : null,
          relativeId: relation === 'member' ? null : relativeId,
          relation
        })
        if (result.error) {
          setError(result.error)
          return
        }
        setStatus(text.added)
        setPayload(emptyPerson())
        setSearch('')
        setSelectedId('')
        setResults([])
        router.refresh()
      } catch {
        setError('error')
      }
    })
  }

  function saveGeneration() {
    setError(null)
    setStatus(null)
    startTransition(async () => {
      try {
        const value = generation.trim() ? Number(generation) : null
        const result = await updateBranchMemberGeneration(
          branch.id,
          generationPersonId,
          value
        )
        if (result.error) {
          setError(result.error)
          return
        }
        setStatus(text.saved)
        router.refresh()
      } catch {
        setError('error')
      }
    })
  }

  function removeRelationship(id: string) {
    if (!window.confirm(text.confirmRemoveRelationship)) return
    setError(null)
    setStatus(null)
    startTransition(async () => {
      try {
        const result = await removeBranchRelationship(branch.id, id)
        if (result.error) {
          setError(result.error)
          return
        }
        setStatus(text.saved)
        router.refresh()
      } catch {
        setError('error')
      }
    })
  }

  return (
    <div className='flex min-h-full flex-col bg-neutral text-sm text-primary'>
      <div className='mx-auto w-full max-w-7xl space-y-5 px-4 pt-6 sm:px-6 lg:px-8'>
        <div className='space-y-2'>
          <Link
            href='/dashboard/members'
            className='text-amber-700 hover:underline'>
            {text.back}
          </Link>
          <h1 className='font-serif text-3xl font-semibold'>{branch.name}</h1>
          <p className='text-secondary'>
            {text.anchor}:{' '}
            {persons.find((person) => person.id === branch.anchor_person_id)
              ?.full_name || '—'}
          </p>
          <Link
            href={`/dashboard/events?branchId=${branch.id}`}
            className='inline-block text-amber-700 hover:underline'>
            {text.calendar}
          </Link>
        </div>
        {error && (
          <p
            role='alert'
            className='rounded-xl border border-border bg-surface p-4 text-error'>
            {messageFor(error, text)}
          </p>
        )}
        {status && (
          <p role='status' className='text-secondary'>
            {status}
          </p>
        )}
        {isAdmin && (
          <BranchPrivacySettings
            key={branch.partner_person_id || 'unassigned'}
            branch={branch}
            partners={partnerOptions}
          />
        )}
        {canEdit && (
          <div className='grid gap-5 lg:grid-cols-2'>
            <section className='space-y-4 rounded-2xl border border-border bg-surface p-5'>
              <h2 className='font-serif text-lg font-semibold'>{text.title}</h2>
              <label className='block space-y-2 text-secondary'>
                <span>{text.name}</span>
                <input
                  className={basicInputClass}
                  value={name}
                  maxLength={150}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className='block space-y-2 text-secondary'>
                <span>{text.root}</span>
                <select
                  className={basicInputClass}
                  value={root}
                  onChange={(event) => setRoot(event.target.value)}>
                  {persons.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={pending || !name.trim()}
                onClick={saveBranch}
                className='rounded-xl bg-primary px-4 py-3 text-sm font-medium text-surface disabled:opacity-50'>
                {pending ? text.saving : text.save}
              </button>
            </section>
            <section className='space-y-4 rounded-2xl border border-border bg-surface p-5'>
              <h2 className='font-serif text-lg font-semibold'>
                {text.generation}
              </h2>
              <label className='block space-y-2 text-secondary'>
                <span>{text.allMembers}</span>
                <select
                  className={basicInputClass}
                  value={generationPersonId}
                  onChange={(event) => {
                    const id = event.target.value
                    setGenerationPersonId(id)
                    setGeneration(
                      String(
                        members.find((member) => member.person_id === id)
                          ?.generation ?? ''
                      )
                    )
                  }}>
                  {persons.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className='block space-y-2 text-secondary'>
                <span>{text.generation}</span>
                <input
                  className={basicInputClass}
                  type='number'
                  min={1}
                  max={10000}
                  value={generation}
                  onChange={(event) => setGeneration(event.target.value)}
                />
              </label>
              <button
                disabled={pending}
                onClick={saveGeneration}
                className='rounded-xl bg-primary px-4 py-3 text-sm font-medium text-surface disabled:opacity-50'>
                {pending ? text.saving : text.save}
              </button>
            </section>
            <section className='space-y-4 rounded-2xl border border-border bg-surface p-5 lg:col-span-2'>
              <h2 className='font-serif text-lg font-semibold'>{text.add}</h2>
              <div className='flex flex-wrap gap-2'>
                <button
                  type='button'
                  onClick={() => {
                    setMode('new')
                    setError(null)
                  }}
                  className={`rounded-xl px-4 py-2 text-sm ${mode === 'new' ? 'bg-primary text-surface' : 'border border-border text-secondary'}`}>
                  {text.createPerson}
                </button>
                <button
                  type='button'
                  onClick={() => {
                    setMode('existing')
                    setError(null)
                  }}
                  className={`rounded-xl px-4 py-2 text-sm ${mode === 'existing' ? 'bg-primary text-surface' : 'border border-border text-secondary'}`}>
                  {text.linkPerson}
                </button>
              </div>
              {mode === 'new' ? (
                <PersonFields value={payload} onChange={setPayload} />
              ) : (
                <div className='space-y-3'>
                  <label className='block space-y-2 text-secondary'>
                    <span>{text.search}</span>
                    <input
                      className={basicInputClass}
                      value={search}
                      onChange={(event) => {
                        setSearch(event.target.value)
                        setSelectedId('')
                        setResults([])
                      }}
                    />
                  </label>
                  <p className='text-secondary'>{text.searchHint}</p>
                  {search.trim().length >= 2 && results.length === 0 && (
                    <p className='text-secondary'>{text.noResults}</p>
                  )}
                  {results.length > 0 && (
                    <select
                      aria-label={text.linkPerson}
                      className={basicInputClass}
                      value={selectedId}
                      onChange={(event) => setSelectedId(event.target.value)}>
                      <option value=''>{text.linkPerson}</option>
                      {results.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.full_name}
                          {person.birth_year ? ` (${person.birth_year})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              <div className='grid gap-4 sm:grid-cols-2'>
                <label className='space-y-2 text-secondary'>
                  <span>{text.relation}</span>
                  <select
                    className={basicInputClass}
                    value={relation}
                    onChange={(event) =>
                      setRelation(event.target.value as BranchRelation)
                    }>
                    {(['member', 'parent', 'child', 'spouse'] as const).map(
                      (value) => (
                        <option key={value} value={value}>
                          {text[value]}
                        </option>
                      )
                    )}
                  </select>
                </label>
                {relation !== 'member' && (
                  <label className='space-y-2 text-secondary'>
                    <span>{text.relative}</span>
                    <select
                      className={basicInputClass}
                      value={relativeId}
                      onChange={(event) => setRelativeId(event.target.value)}>
                      {persons.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.full_name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <p className='text-secondary'>{text.profileEdit}</p>
              <button
                disabled={
                  pending ||
                  (mode === 'new' ? !payload.full_name.trim() : !selectedId)
                }
                onClick={addPerson}
                className='rounded-xl bg-primary px-4 py-3 text-sm font-medium text-surface disabled:opacity-50'>
                {pending ? text.adding : text.add}
              </button>
            </section>
          </div>
        )}
        {canEdit && (
          <section className='rounded-2xl border border-border bg-surface p-5'>
            <BranchRelationshipEditor
              branchId={branch.id}
              persons={persons}
              initialPersonId={branch.anchor_person_id}
            />
          </section>
        )}
        {persons.length > 0 && (
          <section className='space-y-3 rounded-2xl border border-border bg-surface p-5'>
            <h2 className='font-serif text-lg font-semibold'>
              {text.allMembers}
            </h2>
            <ul className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
              {persons.map((person) => (
                <li
                  key={person.id}
                  className='flex items-center justify-between gap-3 rounded-xl bg-neutral px-3 py-2'>
                  <span className='min-w-0 break-words'>
                    {person.full_name}
                    {person.generation != null
                      ? ` · ${text.generation} ${person.generation}`
                      : ''}
                  </span>
                  {canEdit && (
                    <Link
                      href={`/dashboard/members/${person.id}/edit`}
                      className='shrink-0 text-amber-700 hover:underline'>
                      {text.editProfile}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {relationships.some(
          (relationship) => relationship.family_branch_id === branch.id
        ) && (
          <section className='space-y-3 rounded-2xl border border-border bg-surface p-5'>
            <h2 className='font-serif text-lg font-semibold'>
              {text.relationships}
            </h2>
            <ul className='space-y-2'>
              {relationships
                .filter(
                  (relationship) => relationship.family_branch_id === branch.id
                )
                .map((relationship) => (
                  <li
                    key={relationship.id}
                    className='flex flex-wrap items-center justify-between gap-3 rounded-xl bg-neutral px-3 py-2'>
                    <span className='min-w-0 break-words'>
                      {
                        persons.find(
                          (person) => person.id === relationship.person_a
                        )?.full_name
                      }
                      {' · '}
                      {relationship.type === 'marriage'
                        ? text.spouse
                        : text.parent}{' '}
                      {
                        persons.find(
                          (person) => person.id === relationship.person_b
                        )?.full_name
                      }
                    </span>
                    {canEdit && (
                      <button
                        type='button'
                        disabled={pending}
                        onClick={() => removeRelationship(relationship.id)}
                        className='shrink-0 text-sm text-error disabled:opacity-50'>
                        {text.removeRelationship}
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>
      <MemberListProvider
        key={branch.root_person_id || branch.anchor_person_id}
        initialRootId={initialRootId}
        initialView={initialView as ViewMode | undefined}
        initialShowAvatar={initialShowAvatar}>
        <ViewToggle />
        {persons.length ? (
          <MembersViews
            persons={persons}
            relationships={relationships}
            canEdit={false}
            storageKey={`branch_${branch.id}_rootId`}
          />
        ) : (
          <p className='mx-auto w-full max-w-7xl p-6 text-secondary'>
            {text.empty}
          </p>
        )}
        <MemberDetailModal />
      </MemberListProvider>
    </div>
  )
}
