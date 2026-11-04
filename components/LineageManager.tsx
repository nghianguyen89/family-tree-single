'use client'

import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Sparkles
} from 'lucide-react'
import { useState } from 'react'

import { useI18n } from '@/lib/i18n/I18nProvider'
import { Person, Relationship } from '@/types'
import { computeGenerations } from '@/utils/lineage'
import { createClient } from '@/utils/supabase/client'

interface LineageManagerProps {
  persons: Person[]
  relationships: Relationship[]
}

interface ComputedUpdate {
  id: string
  full_name: string
  old_generation: number | null
  new_generation: number | null
  old_birth_order: number | null
  new_birth_order: number | null
  old_is_in_law: boolean
  new_is_in_law: boolean
  gender: string
  changed: boolean
}

// ─── Algorithm helpers ────────────────────────────────────────────────────────

function computeInLaws(
  persons: Person[],
  relationships: Relationship[]
): Map<string, boolean> {
  // A person is an in-law if they have a spouse in the tree but no parents in the tree
  const childParents = new Map<string, string[]>()
  const spouseMap = new Map<string, string[]>()

  for (const r of relationships) {
    if (r.type === 'biological_child' || r.type === 'adopted_child') {
      if (!childParents.has(r.person_b)) childParents.set(r.person_b, [])
      childParents.get(r.person_b)!.push(r.person_a)
    } else if (r.type === 'marriage') {
      if (!spouseMap.has(r.person_a)) spouseMap.set(r.person_a, [])
      spouseMap.get(r.person_a)!.push(r.person_b)
      if (!spouseMap.has(r.person_b)) spouseMap.set(r.person_b, [])
      spouseMap.get(r.person_b)!.push(r.person_a)
    }
  }

  const inLawMap = new Map<string, boolean>()

  // Identify "roots" - people with no parents
  for (const p of persons) {
    const hasParents = childParents.has(p.id)
    const hasSpouse = spouseMap.has(p.id)

    // Rule: If they have parents in the tree, they are bloodline (NOT in-law)
    if (hasParents) {
      inLawMap.set(p.id, false)
      continue
    }

    // Rule: If they have no parents but DO have a spouse
    if (hasSpouse) {
      // Ambiguity check: If NEITHER spouse has parents, one is root, one is in-law.
      // Usually, we keep the one already marked as NOT in-law as the root,
      // or we use gender as a fallback (male = bloodline in many traditional Vietnamese genealogies).
      const spouses = spouseMap.get(p.id) || []
      const anySpouseHasParents = spouses.some((sId) => childParents.has(sId))

      if (anySpouseHasParents) {
        // Spouse is bloodline -> this person is definitely an in-law
        inLawMap.set(p.id, true)
      } else {
        // Neither has parents. Identify the "core" ancestor.
        // If one is already marked as not in-law in DB, keep it.
        // Otherwise, prioritize male.
        const spousesData = spouses.map((sId) =>
          persons.find((per) => per.id === sId)
        )
        const shouldBeBloodline =
          !p.is_in_law ||
          (p.gender === 'male' &&
            spousesData.every((s) => s?.gender !== 'male'))

        inLawMap.set(p.id, !shouldBeBloodline)
      }
    } else {
      // No parents and no spouse -> Root (Generation 1) -> NOT in-law
      inLawMap.set(p.id, false)
    }
  }

  return inLawMap
}

function computeBirthOrders(
  persons: Person[],
  relationships: Relationship[]
): Map<string, number> {
  // For each parent→children group, sort by birth_year and assign order
  const parentChildren = new Map<string, Set<string>>()

  for (const r of relationships) {
    if (r.type === 'biological_child' || r.type === 'adopted_child') {
      if (!parentChildren.has(r.person_a))
        parentChildren.set(r.person_a, new Set())
      parentChildren.get(r.person_a)!.add(r.person_b)
    }
  }

  const personsById = new Map(persons.map((p) => [p.id, p]))
  const orderMap = new Map<string, number>()

  for (const [, childIds] of parentChildren) {
    // Sort children by birth_year (nulls last), then by name alphabetically
    const sorted = Array.from(childIds).sort((a, b) => {
      const pa = personsById.get(a)
      const pb = personsById.get(b)
      const aYear = pa?.birth_year ?? Infinity
      const bYear = pb?.birth_year ?? Infinity
      if (aYear !== bYear) return aYear - bYear
      return (pa?.full_name ?? '').localeCompare(pb?.full_name ?? '', 'vi')
    })

    // Only assign order to non-in-law children
    let order = 1
    for (const childId of sorted) {
      const p = personsById.get(childId)
      if (p && !p.is_in_law) {
        // Keep the largest order if already assigned from another parent
        // (e.g., father has 3 kids, mother has 1 kid. the mother's 1st kid might be father's 3rd. assign 3rd)
        if (!orderMap.has(childId) || orderMap.get(childId)! < order) {
          orderMap.set(childId, order)
        }
        order++
      }
    }
  }

  return orderMap
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function LineageManager({
  persons,
  relationships
}: LineageManagerProps) {
  const { t } = useI18n()
  const supabase = createClient()

  const [updates, setUpdates] = useState<ComputedUpdate[] | null>(null)
  const [computing, setComputing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const handleCompute = () => {
    setComputing(true)
    setApplied(false)
    setError(null)
    setUpdates(null)

    try {
      const genMap = computeGenerations(persons, relationships)
      const orderMap = computeBirthOrders(persons, relationships)
      const inLawMap = computeInLaws(persons, relationships)

      const result: ComputedUpdate[] = persons.map((p) => {
        const newGen = genMap.has(p.id) ? genMap.get(p.id)! : null
        const newOrder = orderMap.has(p.id) ? orderMap.get(p.id)! : null
        const newInLaw = inLawMap.get(p.id) ?? false

        return {
          id: p.id,
          full_name: p.full_name,
          old_generation: p.generation,
          new_generation: newGen,
          old_birth_order: p.birth_order,
          new_birth_order: newOrder,
          old_is_in_law: p.is_in_law,
          new_is_in_law: newInLaw,
          gender: p.gender,
          changed:
            newGen !== p.generation ||
            newOrder !== p.birth_order ||
            newInLaw !== p.is_in_law
        }
      })

      // Sort: changed first, then by new generation, then by new birth_order
      result.sort((a, b) => {
        if (a.changed !== b.changed) return a.changed ? -1 : 1
        const gA = a.new_generation ?? 999
        const gB = b.new_generation ?? 999
        if (gA !== gB) return gA - gB
        const oA = a.new_birth_order ?? 999
        const oB = b.new_birth_order ?? 999
        return oA - oB
      })

      setUpdates(result)
    } catch (err) {
      setError(
        (err as Error).message === 'ancestry_cycle'
          ? t('lineageCycleError')
          : (err as Error).message || t('lineageComputeError')
      )
    } finally {
      setComputing(false)
    }
  }

  const handleApply = async () => {
    if (!updates) return
    setApplying(true)
    setError(null)

    try {
      const { error: updateError } = await supabase.rpc(
        'apply_lineage_updates',
        {
          changes: updates
            .filter((u) => u.changed)
            .map((u) => ({
              id: u.id,
              generation: u.new_generation,
              birth_order: u.new_birth_order,
              is_in_law: u.new_is_in_law
            }))
        }
      )
      if (updateError) throw updateError
      setApplied(true)
    } catch (err) {
      setError((err as Error).message || t('lineageUpdateError'))
    } finally {
      setApplying(false)
    }
  }

  const changedCount = updates?.filter((u) => u.changed).length ?? 0
  const displayedRows = showAll ? (updates ?? []) : (updates ?? []).slice(0, 20)

  return (
    <div className='space-y-6'>
      {/* Action buttons */}
      <div className='flex flex-col gap-3 sm:flex-row'>
        <button
          onClick={handleCompute}
          disabled={computing || applying}
          className='btn-secondary'>
          {computing ? (
            <Loader2 className='size-4 animate-spin' />
          ) : (
            <Sparkles className='size-4' />
          )}
          {computing ? t('calculating') : t('calculate')}
        </button>

        {updates && changedCount > 0 && !applied && (
          <button
            onClick={handleApply}
            disabled={applying}
            className='btn-primary'>
            {applying ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <RefreshCw className='size-4' />
            )}
            {applying
              ? t('updating')
              : t('applyChangesCount', { count: changedCount })}
          </button>
        )}
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className='flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700'>
            <AlertCircle className='mt-0.5 size-5 shrink-0' />
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Success */}
      <AnimatePresence>
        {applied && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className='flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-700'>
            <CheckCircle2 className='size-5 shrink-0' />
            {t('lineageApplied', { count: changedCount })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preview table */}
      {updates && (
        <div>
          <div className='mb-3 flex items-center justify-between'>
            <p className='text-sm font-medium text-stone-500'>
              <span className='font-medium text-stone-800'>{changedCount}</span>{' '}
              {t('membersWillUpdate')} /&nbsp;
              <span className='font-medium text-stone-800'>
                {updates.length}
              </span>{' '}
              {t('total')}
            </p>
          </div>

          <div className='overflow-hidden rounded-2xl border border-stone-200/80'>
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <thead>
                  <tr className='border-b border-stone-200/80 bg-stone-50'>
                    <th className='px-4 py-3 text-left font-medium whitespace-nowrap text-stone-600'>
                      {t('name')}
                    </th>
                    <th className='px-4 py-3 text-center font-medium whitespace-nowrap text-stone-600'>
                      {t('generationColumn')}
                    </th>
                    <th className='px-4 py-3 text-center font-medium whitespace-nowrap text-stone-600'>
                      {t('orderColumn')}
                    </th>
                    <th className='px-4 py-3 text-center font-medium whitespace-nowrap text-stone-600'>
                      {t('inLawColumn')}
                    </th>
                    <th className='px-4 py-3 text-center font-medium text-stone-600'>
                      {t('status')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayedRows.map((u, i) => (
                    <tr
                      key={u.id}
                      className={`border-b border-stone-100 transition-colors last:border-0 ${
                        u.changed ? 'bg-amber-50/40' : ''
                      } ${i % 2 === 0 && !u.changed ? 'bg-surface' : !u.changed ? 'bg-stone-50/30' : ''}`}>
                      <td className='px-4 py-3 font-medium text-stone-800'>
                        {u.full_name}
                      </td>
                      <td className='px-4 py-3 text-center'>
                        <span className='text-stone-400'>
                          {u.old_generation ?? '—'}
                        </span>
                        {u.old_generation !== u.new_generation && (
                          <>
                            <span className='mx-2 text-stone-300'>→</span>
                            <span className='font-medium text-amber-700'>
                              {u.new_generation ?? '—'}
                            </span>
                          </>
                        )}
                      </td>
                      <td className='px-4 py-3 text-center'>
                        <span className='text-stone-400'>
                          {u.old_birth_order ?? '—'}
                        </span>
                        {u.old_birth_order !== u.new_birth_order && (
                          <>
                            <span className='mx-2 text-stone-300'>→</span>
                            <span className='font-medium text-amber-700'>
                              {u.new_birth_order ?? '—'}
                            </span>
                          </>
                        )}
                      </td>
                      <td className='px-4 py-3 text-center'>
                        <span
                          className={
                            u.old_is_in_law !== u.new_is_in_law
                              ? 'text-stone-400'
                              : ''
                          }>
                          {u.old_is_in_law
                            ? u.gender === 'male'
                              ? t('inLawMale')
                              : t('inLawFemale')
                            : '—'}
                        </span>
                        {u.old_is_in_law !== u.new_is_in_law && (
                          <>
                            <span className='mx-2 text-stone-300'>→</span>
                            <span className='font-medium text-amber-700'>
                              {u.new_is_in_law
                                ? u.gender === 'male'
                                  ? t('inLawMale')
                                  : t('inLawFemale')
                                : t('bloodline')}
                            </span>
                          </>
                        )}
                      </td>
                      <td className='px-4 py-3 text-center'>
                        {u.changed ? (
                          <span className='inline-block rounded-full border border-amber-200/60 bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-700'>
                            {t('updated')}
                          </span>
                        ) : (
                          <span className='inline-block rounded-full border border-stone-200/60 bg-stone-100 px-2 py-0.5 text-sm font-medium text-stone-400'>
                            {t('unchanged')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {updates.length > 20 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className='mx-auto mt-3 flex items-center gap-1.5 text-sm font-medium text-stone-500 transition-colors hover:text-amber-700'>
              {showAll ? (
                <>
                  <ChevronUp className='size-4' /> {t('collapse')}
                </>
              ) : (
                <>
                  <ChevronDown className='size-4' />{' '}
                  {t('showAllMembers', { count: updates.length })}
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
