'use client'

import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeftRight,
  BookOpen,
  GitMerge,
  Info,
  Search,
  Sparkles,
  Users
} from 'lucide-react'
import Image from 'next/image'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import { useI18n } from '@/lib/i18n/I18nProvider'
import type { TranslationKey } from '@/lib/i18n/messages'
import { getAvatarUrl } from '@/utils/avatar'
import { computeKinship } from '@/utils/kinshipHelpers'
import { getAvatarBg } from '@/utils/styleHelprs'

import DefaultAvatar from './DefaultAvatar'
import { FemaleIcon, MaleIcon } from './GenderIcons'

interface PersonNode {
  id: string
  full_name: string
  gender: 'male' | 'female' | 'other'
  birth_year: number | null
  birth_order: number | null
  generation: number | null
  is_in_law: boolean
  avatar_url?: string | null
}

interface RelEdge {
  type: string
  person_a: string
  person_b: string
}

interface Props {
  persons: PersonNode[]
  relationships: RelEdge[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const getGenderStyle = (gender: string) => {
  if (gender === 'male') return 'bg-sky-100 text-sky-600'
  if (gender === 'female') return 'bg-rose-100 text-rose-600'
  return 'bg-stone-100 text-stone-600'
}

// ── Person selector dropdown ──────────────────────────────────────────────────
function PersonSelector({
  label,
  selected,
  onSelect,
  persons,
  disabledId
}: {
  label: string
  selected: PersonNode | null
  onSelect: (p: PersonNode) => void
  persons: PersonNode[]
  disabledId?: string
}) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = useMemo(
    () =>
      persons
        .filter(
          (p) =>
            p.id !== disabledId &&
            p.full_name.toLowerCase().includes(search.toLowerCase())
        )
        .slice(0, 20),
    [persons, disabledId, search]
  )

  return (
    <div className='relative w-full min-w-0 flex-1'>
      <p className='mb-2 text-sm font-medium text-stone-400'>{label}</p>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all ${
          selected
            ? 'border-amber-300 bg-amber-50 text-stone-800'
            : 'border-stone-200 bg-surface/80 text-stone-400 hover:border-amber-200'
        }`}>
        <div className='relative shrink-0'>
          <div
            className={`flex size-10 items-center justify-center overflow-hidden rounded-full text-sm font-medium text-white shadow-sm ring-2 ring-surface ${selected ? getAvatarBg(selected.gender) : 'bg-stone-100 text-stone-400'}`}>
            {selected ? (
              getAvatarUrl(selected.avatar_url) ? (
                <Image
                  unoptimized
                  src={getAvatarUrl(selected.avatar_url)!}
                  alt={selected.full_name}
                  width={40}
                  height={40}
                  className='h-full w-full object-cover'
                />
              ) : (
                <DefaultAvatar gender={selected.gender} size={40} />
              )
            ) : (
              '?'
            )}
          </div>
          {selected && (
            <div
              className={`absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full shadow-xs ring-2 ring-surface ${getGenderStyle(selected.gender)}`}>
              {selected.gender === 'male' ? (
                <MaleIcon className='size-3' />
              ) : selected.gender === 'female' ? (
                <FemaleIcon className='size-3' />
              ) : null}
            </div>
          )}
        </div>

        <span className='truncate font-medium'>
          {selected ? selected.full_name : t('selectMember')}
        </span>
        {selected?.birth_year && (
          <span className='shrink-0 text-sm text-stone-400'>
            ({selected.birth_year})
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className='absolute top-full right-0 left-0 z-50 mt-2 overflow-hidden rounded-2xl border border-stone-200/60 bg-surface'>
            <div className='border-b border-stone-100 p-3'>
              <div className='relative'>
                <Search className='absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400' />
                <input
                  autoFocus
                  placeholder={t('searchName')}
                  className='w-full rounded-xl border border-stone-200 py-2 pr-4 pl-9 text-sm focus:border-amber-400 focus:outline-none sm:text-sm'
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className='max-h-52 overflow-y-auto'>
              {filtered.length === 0 ? (
                <p className='py-6 text-center text-sm text-stone-400'>
                  {t('noSearchResults')}
                </p>
              ) : (
                filtered.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      onSelect(p)
                      setOpen(false)
                      setSearch('')
                    }}
                    className='flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-amber-50'>
                    <div className='relative shrink-0'>
                      <div
                        className={`flex size-8 items-center justify-center overflow-hidden rounded-full text-sm font-medium text-white shadow-xs ring-1 ring-surface ${getAvatarBg(p.gender)}`}>
                        {getAvatarUrl(p.avatar_url) ? (
                          <Image
                            unoptimized
                            src={getAvatarUrl(p.avatar_url)!}
                            alt={p.full_name}
                            width={32}
                            height={32}
                            className='h-full w-full object-cover'
                          />
                        ) : (
                          <DefaultAvatar gender={p.gender} size={32} />
                        )}
                      </div>
                      <div
                        className={`absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full shadow-xs ring-1 ring-surface ${getGenderStyle(p.gender)}`}>
                        {p.gender === 'male' ? (
                          <MaleIcon className='size-2.5' />
                        ) : p.gender === 'female' ? (
                          <FemaleIcon className='size-2.5' />
                        ) : null}
                      </div>
                    </div>

                    <span className='truncate text-sm font-medium text-stone-700'>
                      {p.full_name}
                    </span>
                    {p.birth_year && (
                      <span className='ml-auto shrink-0 text-sm text-stone-400'>
                        {p.birth_year}
                      </span>
                    )}
                    {p.generation != null && (
                      <span className='shrink-0 rounded-md bg-emerald-50 px-1.5 py-0.5 text-sm text-emerald-600'>
                        {t('generationLabel', { generation: p.generation })}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Kinship reference table data ──────────────────────────────────────────────
const KINSHIP_TERMS: [TranslationKey, TranslationKey, TranslationKey][] = [
  ['kinshipTerm1Relation', 'kinshipTerm1Desc', 'kinshipTerm1Example'],
  ['kinshipTerm2Relation', 'kinshipTerm2Desc', 'kinshipTerm2Example'],
  ['kinshipTerm3Relation', 'kinshipTerm3Desc', 'kinshipTerm3Example'],
  ['kinshipTerm4Relation', 'kinshipTerm4Desc', 'kinshipTerm4Example'],
  ['kinshipTerm5Relation', 'kinshipTerm5Desc', 'kinshipTerm5Example'],
  ['kinshipTerm6Relation', 'kinshipTerm6Desc', 'kinshipTerm6Example'],
  ['kinshipTerm7Relation', 'kinshipTerm7Desc', 'kinshipTerm7Example'],
  ['kinshipTerm8Relation', 'kinshipTerm8Desc', 'kinshipTerm8Example']
]

// ── Regional kinship terms ────────────────────────────────────────────────────
const REGIONAL_TERMS: [TranslationKey, TranslationKey][] = [
  ['regionalTerm1Reference', 'regionalTerm1Other'],
  ['regionalTerm2Reference', 'regionalTerm2Other'],
  ['regionalTerm3Reference', 'regionalTerm3Other'],
  ['regionalTerm4Reference', 'regionalTerm4Other'],
  ['regionalTerm5Reference', 'regionalTerm5Other'],
  ['regionalTerm6Reference', 'regionalTerm6Other'],
  ['regionalTerm7Reference', 'regionalTerm7Other'],
  ['regionalTerm8Reference', 'regionalTerm8Other'],
  ['regionalTerm9Reference', 'regionalTerm9Other'],
  ['regionalTerm10Reference', 'regionalTerm10Other'],
  ['regionalTerm11Reference', 'regionalTerm11Other'],
  ['regionalTerm12Reference', 'regionalTerm12Other'],
  ['regionalTerm13Reference', 'regionalTerm13Other']
]

// ── Main component ────────────────────────────────────────────────────────────
export default function KinshipFinder({ persons, relationships }: Props) {
  const { t } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const p1Id = searchParams.get('p1')
  const p2Id = searchParams.get('p2')

  useEffect(() => {
    if (!p1Id && !p2Id) {
      try {
        const savedP1 = localStorage.getItem('kinship_p1')
        const savedP2 = localStorage.getItem('kinship_p2')
        if (savedP1 || savedP2) {
          const params = new URLSearchParams(searchParams.toString())
          if (savedP1) params.set('p1', savedP1)
          if (savedP2) params.set('p2', savedP2)
          router.replace(`${pathname}?${params.toString()}`, { scroll: false })
        }
      } catch (e) {
        console.warn('Failed to read from localStorage:', e)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    try {
      if (p1Id) localStorage.setItem('kinship_p1', p1Id)
      else localStorage.removeItem('kinship_p1')

      if (p2Id) localStorage.setItem('kinship_p2', p2Id)
      else localStorage.removeItem('kinship_p2')
    } catch (e) {
      console.warn('Failed to write to localStorage:', e)
    }
  }, [p1Id, p2Id])

  const personA = useMemo(
    () => persons.find((p) => p.id === p1Id) || null,
    [persons, p1Id]
  )
  const personB = useMemo(
    () => persons.find((p) => p.id === p2Id) || null,
    [persons, p2Id]
  )

  const [showGuide, setShowGuide] = useState(false)
  const [showReference, setShowReference] = useState(false)
  const [showRegional, setShowRegional] = useState(false)

  const updateUrl = (p1Id: string | null, p2Id: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (p1Id) params.set('p1', p1Id)
    else params.delete('p1')
    if (p2Id) params.set('p2', p2Id)
    else params.delete('p2')

    const newUrl = `${pathname}?${params.toString()}`
    router.replace(newUrl, { scroll: false })
  }

  const result = useMemo(() => {
    if (!personA || !personB) return null
    return computeKinship(personA, personB, persons, relationships)
  }, [personA, personB, persons, relationships])

  const swap = () => {
    updateUrl(p2Id, p1Id)
  }

  return (
    <div className='space-y-6'>
      {/* ── Selector row ── */}
      <div className='rounded-2xl border border-stone-200/60 bg-surface/80 p-4 sm:p-6'>
        <div className='flex flex-col items-center gap-3 sm:flex-row sm:items-end sm:gap-4'>
          <PersonSelector
            label={t('memberA')}
            selected={personA}
            onSelect={(p) => updateUrl(p.id, p2Id)}
            persons={persons}
            disabledId={personB?.id}
          />
          <button
            onClick={swap}
            title={t('swapMembers')}
            className='flex size-10 shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-stone-100 text-stone-500 transition-all hover:bg-amber-100 hover:text-amber-600 sm:mb-0.5'>
            <ArrowLeftRight className='size-4 rotate-90 sm:rotate-0' />
          </button>
          <PersonSelector
            label={t('memberB')}
            selected={personB}
            onSelect={(p) => updateUrl(p1Id, p.id)}
            persons={persons}
            disabledId={personA?.id}
          />
        </div>
      </div>

      {/* ── Result ── */}
      <AnimatePresence mode='wait'>
        {!personA || !personB ? (
          <motion.div
            key='empty'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className='py-16 text-center text-stone-400'>
            <Users className='mx-auto mb-3 size-12 opacity-30' />
            <p className='font-medium'>{t('chooseTwoMembers')}</p>
          </motion.div>
        ) : result === null ? (
          <motion.div key='same' className='py-8 text-center text-stone-400'>
            {t('chooseDifferentMembers')}
          </motion.div>
        ) : (
          <motion.div
            key={`${personA.id}-${personB.id}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className='space-y-4'>
            {/* Description badge */}
            <div className='flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4'>
              <Sparkles className='size-5 shrink-0 text-amber-500' />
              <p className='font-medium text-amber-800'>{result.description}</p>
            </div>

            {/* Main kinship cards */}
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
                className='rounded-2xl border border-stone-200/60 bg-surface/90 p-5'>
                <p className='mb-3 text-sm font-medium text-stone-400'>
                  {t('callsAs', {
                    name: personA.full_name,
                    other: personB.full_name
                  })}
                </p>
                <p className='font-serif text-sm font-medium text-amber-600'>
                  {result.aCallsB}
                </p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 }}
                className='rounded-2xl border border-stone-200/60 bg-surface/90 p-5'>
                <p className='mb-3 text-sm font-medium text-stone-400'>
                  {t('callsAs', {
                    name: personB.full_name,
                    other: personA.full_name
                  })}
                </p>
                <p className='font-serif text-sm font-medium text-amber-600'>
                  {result.bCallsA}
                </p>
              </motion.div>
            </div>

            {/* Path info */}
            {result.pathLabels.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.25 }}
                className='rounded-2xl border border-stone-200/60 bg-stone-50 px-6 py-5'>
                <div className='mb-4 flex items-center gap-2'>
                  <GitMerge className='size-4 text-stone-400' />
                  <p className='text-sm font-medium text-stone-400'>
                    {t('relationPathAnalysis')}
                  </p>
                </div>
                <div className='space-y-4'>
                  {result.pathLabels.map((label, i) => (
                    <div key={i} className='flex items-start gap-4'>
                      <div className='mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-surface'>
                        <span className='text-sm font-medium text-stone-400'>
                          {i + 1}
                        </span>
                      </div>
                      <p className='pt-1 text-sm leading-relaxed text-stone-600'>
                        {label}
                      </p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Disclaimer for ambiguous terms */}
            {(result.aCallsB.includes('/') ||
              result.aCallsB.includes('họ hàng')) && (
              <p className='px-1 text-sm text-stone-400 italic'>
                {t('kinshipDisclaimer')}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Guide & reference section ── */}
      <div className='space-y-4 border-t border-stone-200/60 pt-6'>
        <div className='flex flex-wrap items-center gap-6'>
          <button
            onClick={() => {
              setShowGuide((v) => !v)
              if (!showGuide) {
                setShowReference(false)
                setShowRegional(false)
              }
            }}
            className={`flex items-center gap-2 text-sm font-medium transition-colors ${showGuide ? 'text-amber-600' : 'text-stone-500 hover:text-amber-600'}`}>
            <Info className='size-4' />
            {t('usageGuide')}
          </button>
          <button
            onClick={() => {
              setShowReference((v) => !v)
              if (!showReference) {
                setShowGuide(false)
                setShowRegional(false)
              }
            }}
            className={`flex items-center gap-2 text-sm font-medium transition-colors ${showReference ? 'text-amber-600' : 'text-stone-500 hover:text-amber-600'}`}>
            <BookOpen className='size-4' />
            {t('kinshipReference')}
          </button>
          <button
            onClick={() => {
              setShowRegional((v) => !v)
              if (!showRegional) {
                setShowGuide(false)
                setShowReference(false)
              }
            }}
            className={`flex items-center gap-2 text-sm font-medium transition-colors ${showRegional ? 'text-amber-600' : 'text-stone-500 hover:text-amber-600'}`}>
            <ArrowLeftRight className='size-4' />
            {t('regionalTerms')}
          </button>
        </div>

        <AnimatePresence mode='wait'>
          {showGuide && (
            <motion.div
              key='guide'
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className='overflow-hidden'>
              <div className='space-y-5 pb-2'>
                {/* How it works */}
                <div className='rounded-2xl border border-blue-100 bg-blue-50/60 p-5'>
                  <p className='mb-3 flex items-center gap-2 text-sm font-medium text-blue-700'>
                    <Info className='size-4' />
                    {t('howItWorks')}
                  </p>
                  <ol className='space-y-2 text-sm text-blue-800'>
                    <li className='flex gap-2'>
                      <span className='shrink-0 font-medium'>1.</span>
                      {t('guideStep1')}
                    </li>
                    <li className='flex gap-2'>
                      <span className='shrink-0 font-medium'>2.</span>
                      {t('guideStep2')}
                    </li>
                    <li className='flex gap-2'>
                      <span className='shrink-0 font-medium'>3.</span>
                      {t('guideStep3')}
                    </li>
                    <li className='flex gap-2'>
                      <span className='shrink-0 font-medium'>4.</span>
                      {t('guideStep4')}
                    </li>
                    <li className='flex gap-2'>
                      <span className='shrink-0 font-medium'>5.</span>
                      {t('guideStep5')}
                    </li>
                  </ol>
                </div>

                {/* Data requirements */}
                <div className='rounded-2xl border border-amber-100 bg-amber-50/60 p-5'>
                  <p className='mb-2 flex items-center gap-2 text-sm font-medium text-amber-700'>
                    <Info className='size-4' />
                    {t('dataRequirements')}
                  </p>
                  <ul className='space-y-1.5 text-sm text-amber-800'>
                    <li className='flex gap-2'>
                      <span className='shrink-0 text-amber-400'>•</span>
                      {t('dataRequirement1')}
                    </li>
                    <li className='flex gap-2'>
                      <span className='shrink-0 text-amber-400'>•</span>
                      {t('dataRequirement2')}
                    </li>
                    <li className='flex gap-2'>
                      <span className='shrink-0 text-amber-400'>•</span>
                      {t('dataRequirement3')}
                    </li>
                  </ul>
                </div>
              </div>
            </motion.div>
          )}

          {showReference && (
            <motion.div
              key='reference'
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className='overflow-hidden'>
              <div className='space-y-5 pb-2'>
                {/* Reference table */}
                <div className='overflow-hidden rounded-2xl border border-stone-200/60 bg-surface/80'>
                  <div className='border-b border-stone-100 bg-stone-50/50 px-5 py-3'>
                    <p className='text-sm font-medium text-stone-600'>
                      {t('referenceTableTitle')}
                    </p>
                  </div>
                  <div className='divide-y divide-stone-100'>
                    {KINSHIP_TERMS.map((row) => (
                      <div
                        key={row[0]}
                        className='flex items-start gap-4 px-5 py-3'>
                        <span className='w-48 shrink-0 text-sm font-medium text-amber-700'>
                          {t(row[0])}
                        </span>
                        <div className='min-w-0'>
                          <p className='text-sm text-stone-600'>{t(row[1])}</p>
                          <p className='mt-0.5 text-sm text-stone-400'>
                            {t(row[2])}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {showRegional && (
            <motion.div
              key='regional'
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className='overflow-hidden'>
              <div className='space-y-5 pb-2'>
                {/* Regional Reference table */}
                <div className='overflow-hidden rounded-2xl border border-stone-200/60 bg-surface/80'>
                  <div className='border-b border-stone-100 bg-stone-50/50 px-5 py-3'>
                    <p className='text-sm font-medium text-stone-600'>
                      {t('regionalDescription')}
                    </p>
                  </div>
                  <div className='overflow-x-auto'>
                    <table className='w-full text-left text-sm'>
                      <thead className='border-b border-stone-100 bg-stone-50/30 text-sm text-stone-500'>
                        <tr>
                          <th className='w-1/2 border-r border-stone-100 px-5 py-3 font-medium text-emerald-700'>
                            {t('referenceColumn')}
                          </th>
                          <th className='w-1/2 px-5 py-3 font-medium text-amber-700'>
                            {t('alternateNames')}
                          </th>
                        </tr>
                      </thead>
                      <tbody className='divide-y divide-stone-100'>
                        {REGIONAL_TERMS.map((row) => (
                          <tr
                            key={row[0]}
                            className='transition-colors hover:bg-stone-50/50'>
                            <td className='border-r border-stone-100/50 px-5 py-3 font-medium text-stone-700'>
                              {t(row[0])}
                            </td>
                            <td className='px-5 py-3 text-stone-600'>
                              {t(row[1])}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Fun facts */}
                <div className='rounded-2xl border border-blue-100 bg-blue-50/60 p-5'>
                  <p className='mb-4 flex items-center gap-2 text-sm font-medium text-blue-700'>
                    <Info className='size-4' />
                    {t('regionalFactsTitle')}
                  </p>
                  <div className='mt-5 border-t border-blue-200/50 pt-4'>
                    <p className='font-medium text-blue-900'>
                      {t('regionalFactsHeading')}
                    </p>
                    <p className='mt-2 leading-relaxed'>
                      {t('regionalFactsDescription')}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
