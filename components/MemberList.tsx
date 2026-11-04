'use client'

import { ArrowUpDown, Filter, Plus, Search, X } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'

import PersonCard from '@/components/PersonCard'
import { useMemberListView } from '@/context/MemberListContext'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { Person, Relationship } from '@/types'
import { normalizeSearchText } from '@/utils/search'

export default function MemberList({
  initialPersons,
  relationships = [],
  canEdit = false
}: {
  initialPersons: Person[]
  relationships?: Relationship[]
  canEdit?: boolean
}) {
  const { setShowCreateMember } = useMemberListView()
  const { t } = useI18n()
  const [searchTerm, setSearchTerm] = useState('')
  const [sortOption, setSortOption] = useState('generation_asc')

  const [filterOption, setFilterOption] = useState('all')

  // Typing stays responsive: filtering/sorting large lists runs at lower priority
  const deferredSearchTerm = useDeferredValue(searchTerm)
  const deferredFilterOption = useDeferredValue(filterOption)
  const deferredSortOption = useDeferredValue(sortOption)
  const isStale =
    deferredSearchTerm !== searchTerm ||
    deferredFilterOption !== filterOption ||
    deferredSortOption !== sortOption

  const personMap = useMemo(() => {
    const map = new Map<string, Person>()
    initialPersons.forEach((p) => map.set(p.id, p))
    return map
  }, [initialPersons])

  // Accent-insensitive search index over full name and other names
  const searchIndex = useMemo(() => {
    const index = new Map<string, string>()
    initialPersons.forEach((p) =>
      index.set(
        p.id,
        normalizeSearchText(`${p.full_name} ${p.other_names ?? ''}`)
      )
    )
    return index
  }, [initialPersons])

  const filteredPersons = useMemo(() => {
    const query = normalizeSearchText(deferredSearchTerm)
    const filterOption = deferredFilterOption

    return initialPersons.filter((person) => {
      const matchesSearch =
        !query || (searchIndex.get(person.id) ?? '').includes(query)

      let matchesFilter = true
      switch (filterOption) {
        case 'male':
          matchesFilter = person.gender === 'male'
          break
        case 'female':
          matchesFilter = person.gender === 'female'
          break
        case 'in_law_female':
          matchesFilter = person.gender === 'female' && person.is_in_law
          break
        case 'in_law_male':
          matchesFilter = person.gender === 'male' && person.is_in_law
          break
        case 'deceased':
          matchesFilter = person.is_deceased
          break
        case 'first_child':
          matchesFilter = person.birth_order === 1
          break
        case 'all':
        default:
          matchesFilter = true
          break
      }

      return matchesSearch && matchesFilter
    })
  }, [initialPersons, searchIndex, deferredSearchTerm, deferredFilterOption])

  const { parentsOf, spousesOf } = useMemo(() => {
    const pOf = new Map<string, string[]>()
    const sOf = new Map<string, string[]>()

    relationships?.forEach((rel) => {
      if (rel.type === 'biological_child' || rel.type === 'adopted_child') {
        const parentId = rel.person_a
        const childId = rel.person_b
        if (!pOf.has(childId)) pOf.set(childId, [])
        pOf.get(childId)!.push(parentId)
      } else if (rel.type === 'marriage') {
        const p1 = rel.person_a
        const p2 = rel.person_b
        if (!sOf.has(p1)) sOf.set(p1, [])
        if (!sOf.has(p2)) sOf.set(p2, [])
        sOf.get(p1)!.push(p2)
        sOf.get(p2)!.push(p1)
      }
    })

    return { parentsOf: pOf, spousesOf: sOf }
  }, [relationships])

  const sortedPersons = useMemo(() => {
    const sortOption = deferredSortOption
    // If not sorting by generation, use simple flat sort
    if (!sortOption.includes('generation')) {
      return [...filteredPersons].sort((a, b) => {
        switch (sortOption) {
          case 'birth_asc':
            return (a.birth_year || 9999) - (b.birth_year || 9999)
          case 'birth_desc':
            return (b.birth_year || 0) - (a.birth_year || 0)
          case 'name_asc':
            return a.full_name.localeCompare(b.full_name, 'vi')
          case 'name_desc':
            return b.full_name.localeCompare(a.full_name, 'vi')
          case 'updated_desc':
            return (
              new Date(b.updated_at || 0).getTime() -
              new Date(a.updated_at || 0).getTime()
            )
          case 'updated_asc':
            return (
              new Date(a.updated_at || 0).getTime() -
              new Date(b.updated_at || 0).getTime()
            )
          default:
            return 0
        }
      })
    }

    // --- Complex Generation Sorting (Grouped by Family) ---
    // 2. Determine "Family Groups" within the same generation
    // We group people if they share the same parents, OR if they are spouses
    // A family groupId will be derived from:
    // a) Their parents' IDs (sorted and joined)
    // b) If no parents, their own ID (or their spouse's, whoever is sorted first)
    const getGroupId = (personId: string) => {
      const parents = parentsOf.get(personId) || []
      if (parents.length > 0) {
        // Has parents -> group by parents
        return 'parents_' + [...parents].sort().join('_')
      }

      // No parents -> check spouses and then check if those spouses have parents
      // Use a small BFS to find the whole marriage cluster
      const visited = new Set<string>([personId])
      const queue = [personId]
      const cluster: string[] = []

      while (queue.length > 0) {
        const curr = queue.shift()!
        cluster.push(curr)
        const pts = parentsOf.get(curr)
        if (pts && pts.length > 0) {
          // Found a bloodline member in the marriage cluster!
          return 'parents_' + [...pts].sort().join('_')
        }

        const sps = spousesOf.get(curr) || []
        for (const s of sps) {
          if (!visited.has(s)) {
            visited.add(s)
            queue.push(s)
          }
        }
      }

      // No one in marriage cluster has parents -> group by the cluster's min ID
      return 'spouses_' + [...cluster].sort()[0]
    }

    // 3. Group the filtered persons into their families
    const families = new Map<string, Person[]>()
    filteredPersons.forEach((p) => {
      const groupId = getGroupId(p.id)
      if (!families.has(groupId)) families.set(groupId, [])
      families.get(groupId)!.push(p)
    })

    // 4. Sort families and persons within families
    // To sort families, we need a representative "score" based on the parents' birth order
    // or the primary member's birth order/birth year.
    const getFamilyScore = (groupId: string, members: Person[]) => {
      // Find the "core" member (usually the bloodline, not in-law)
      // Bloodline members usually have parents in the system or are not-in-law
      const coreMember = members.find((m) => !m.is_in_law) || members[0]

      // Score is represented as an array [generation, parentBirthOrder, ownBirthOrder, birthYear]
      // We only care about parentBirthOrder and ownBirthOrder for sorting families.
      const parents = parentsOf.get(coreMember.id) || []
      let parentBirthOrder = 999
      if (parents.length > 0) {
        const p1 = personMap.get(parents[0])
        if (p1) parentBirthOrder = p1.birth_order || 999
      }

      return {
        parentBirthOrder,
        ownBirthOrder: coreMember.birth_order || 999,
        birthYear: coreMember.birth_year || 9999
      }
    }

    const familyScores = new Map(
      Array.from(families.entries()).map(([groupId, members]) => [
        groupId,
        getFamilyScore(groupId, members)
      ])
    )

    const sortedGroups = Array.from(families.entries()).sort((a, b) => {
      const scoreA = familyScores.get(a[0])!
      const scoreB = familyScores.get(b[0])!

      if (scoreA.parentBirthOrder !== scoreB.parentBirthOrder) {
        return scoreA.parentBirthOrder - scoreB.parentBirthOrder
      }
      if (scoreA.ownBirthOrder !== scoreB.ownBirthOrder) {
        return scoreA.ownBirthOrder - scoreB.ownBirthOrder
      }
      return scoreA.birthYear - scoreB.birthYear
    })

    // 5. Flatten the grouped and sorted families
    const finalSorted: Array<Person & { _familyId?: string }> = []
    sortedGroups.forEach(([groupId, members]) => {
      // Sort within the family (Siblings by birth order, spouses follow their partner)
      const getBloodlineRef = (p: Person) => {
        if (!p.is_in_law) return p
        const spIds = spousesOf.get(p.id) || []
        const bloodlineSpouse = members.find(
          (m) => spIds.includes(m.id) && !m.is_in_law
        )
        return bloodlineSpouse || p
      }

      members.sort((a, b) => {
        const refA = getBloodlineRef(a)
        const refB = getBloodlineRef(b)

        // Different bloodline partner -> sort by the bloodline partner's order/age
        if (refA.id !== refB.id) {
          if ((refA.birth_order || 999) !== (refB.birth_order || 999)) {
            return (refA.birth_order || 999) - (refB.birth_order || 999)
          }
          return (refA.birth_year || 9999) - (refB.birth_year || 9999)
        }

        // Same bloodline partner (e.g. one is bloodline, other is spouse)
        if (a.is_in_law !== b.is_in_law) {
          return a.is_in_law ? 1 : -1 // Bloodline first
        }

        // Both are spouses or both bloodline? Sort by age
        return (a.birth_year || 9999) - (b.birth_year || 9999)
      })
      finalSorted.push(...members.map((m) => ({ ...m, _familyId: groupId })))
    })

    // 6. Handle master generation_asc / generation_desc
    // `finalSorted` is now sorted ascending by family grouping and within family.
    // However, they might be mixed generations if we didn't strictly group by generation first.
    // Actually, the rendering code groups by generation AFTER this sort.
    // So if the outer sort wants desc, we just reverse the intra-generation logic?
    // Wait, the rendering code `Object.entries(...reduce(...))` groups by `generation`.
    // Then it sorts the generation keys.
    // Inside a single generation bucket, it preserves the array order.
    // So we just need to ensure the array provided to reduce is correctly ordered ascending.
    // If sortOption === 'generation_desc', the rendering sorts keys descending, but should it reverse within the generation?
    // Usually families are still displayed older->younger even if generations are grouped Z-A.
    // We will apply a default ascending flow to `finalSorted`.

    // If generation_desc is strictly needed across the whole list (if not grouped by UI later),
    // we'd sort by generation here. But since UI groups by generation, we just return `finalSorted`.
    // Let's ensure generation is the primary sort key just in case.
    finalSorted.sort((a, b) => {
      const genA = a.generation || 999
      const genB = b.generation || 999
      if (genA !== genB) {
        return sortOption === 'generation_desc' ? genB - genA : genA - genB
      }
      // If same generation, preserve the family sorting we just did
      return 0
    })

    return finalSorted
  }, [filteredPersons, deferredSortOption, personMap, parentsOf, spousesOf])

  return (
    <>
      <div className='relative mb-8'>
        <div className='relative z-10 flex w-full flex-col items-start justify-between gap-4 rounded-2xl border border-stone-200/60 bg-surface p-4 transition-all duration-300 sm:flex-row sm:items-center sm:p-5'>
          <div className='flex w-full flex-1 flex-col gap-4 sm:w-auto sm:flex-row'>
            <div className='group relative max-w-sm flex-1'>
              <Search className='absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-stone-400 transition-colors group-focus-within:text-amber-500' />
              <input
                type='search'
                placeholder={t('searchMembers')}
                aria-label={t('searchMembers')}
                className='w-full rounded-xl border border-stone-200/80 bg-surface/90 py-2.5 pr-10 pl-10 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 focus:outline-none [&::-webkit-search-cancel-button]:appearance-none'
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearchTerm('')
                }}
              />
              {searchTerm && (
                <button
                  type='button'
                  onClick={() => setSearchTerm('')}
                  className='absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700'
                  aria-label={t('clearSearch')}
                  title={t('clearSearch')}>
                  <X className='size-4' />
                </button>
              )}
            </div>
            <div className='flex w-full flex-col items-center gap-2 sm:w-auto sm:flex-row sm:gap-3'>
              <div className='relative w-full sm:w-auto'>
                <Filter className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400' />
                <select
                  className='w-full appearance-none rounded-xl border border-stone-200/80 bg-surface/90 py-2.5 pr-8 pl-9 text-sm font-medium text-stone-700 transition-all hover:border-amber-300 focus:border-amber-400 focus:bg-surface focus:ring-2 focus:ring-amber-500/20 focus:outline-none sm:w-40'
                  value={filterOption}
                  onChange={(e) => setFilterOption(e.target.value)}>
                  <option value='all'>{t('all')}</option>
                  <option value='male'>{t('male')}</option>
                  <option value='female'>{t('female')}</option>
                  <option value='in_law_female'>{t('daughterInLaw')}</option>
                  <option value='in_law_male'>{t('sonInLaw')}</option>
                  <option value='deceased'>{t('deceased')}</option>
                  <option value='first_child'>{t('firstChild')}</option>
                </select>
                <div className='pointer-events-none absolute inset-y-0 right-0 flex items-center px-2'>
                  <svg
                    className='size-4 text-stone-400'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth='2'
                      d='M19 9l-7 7-7-7'></path>
                  </svg>
                </div>
              </div>

              <div className='relative w-full sm:w-auto'>
                <ArrowUpDown className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400' />
                <select
                  className='w-full appearance-none rounded-xl border border-stone-200/80 bg-surface/90 py-2.5 pr-8 pl-9 text-sm font-medium text-stone-700 transition-all hover:border-amber-300 focus:border-amber-400 focus:bg-surface focus:ring-2 focus:ring-amber-500/20 focus:outline-none sm:w-52'
                  value={sortOption}
                  onChange={(e) => setSortOption(e.target.value)}>
                  <option value='birth_asc'>{t('birthAsc')}</option>
                  <option value='birth_desc'>{t('birthDesc')}</option>
                  <option value='name_asc'>{t('nameAsc')}</option>
                  <option value='name_desc'>{t('nameDesc')}</option>
                  <option value='updated_desc'>{t('updatedDesc')}</option>
                  <option value='updated_asc'>{t('updatedAsc')}</option>
                  <option value='generation_asc'>{t('generationAsc')}</option>
                  <option value='generation_desc'>{t('generationDesc')}</option>
                </select>
                <div className='pointer-events-none absolute inset-y-0 right-0 flex items-center px-2'>
                  <svg
                    className='size-4 text-stone-400'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth='2'
                      d='M19 9l-7 7-7-7'></path>
                  </svg>
                </div>
              </div>
            </div>
          </div>
          {canEdit && (
            <button
              onClick={() => setShowCreateMember(true)}
              className='btn-primary'>
              <Plus className='size-4' strokeWidth={2.5} />
              {t('addMember')}
            </button>
          )}
        </div>
      </div>

      {(searchTerm || filterOption !== 'all') && (
        <p
          className='-mt-4 mb-6 px-1 text-sm text-stone-500'
          aria-live='polite'>
          {t('showingMembers', {
            shown: filteredPersons.length,
            total: initialPersons.length
          })}
        </p>
      )}

      <div
        className={`transition-opacity duration-150 ${isStale ? 'opacity-60' : ''}`}>
        {sortedPersons.length > 0 ? (
          deferredSortOption.includes('generation') ? (
            <div className='space-y-12'>
              {Object.entries(
                sortedPersons.reduce(
                  (acc, person) => {
                    const gen = person.generation || 0
                    if (!acc[gen]) acc[gen] = []
                    acc[gen].push(person)
                    return acc
                  },
                  {} as Record<number, Person[]>
                )
              )
                .sort(([genA], [genB]) => {
                  if (deferredSortOption === 'generation_desc') {
                    return Number(genB) - Number(genA)
                  }
                  return Number(genA) - Number(genB)
                })
                .map(([gen, persons]) => {
                  const familiesMap = new Map<string, typeof persons>()
                  persons.forEach((p) => {
                    const fid =
                      (p as Person & { _familyId?: string })._familyId ||
                      'unknown'
                    if (!familiesMap.has(fid)) familiesMap.set(fid, [])
                    familiesMap.get(fid)!.push(p)
                  })

                  return (
                    <div key={gen} className='space-y-6'>
                      <div className='flex items-center gap-3'>
                        <div className='h-px flex-1 bg-stone-200'></div>
                        <h3 className='rounded-full border border-amber-200/50 bg-amber-50 px-4 py-1.5 font-serif text-lg font-semibold text-amber-800'>
                          {gen === '0'
                            ? t('unknownGeneration')
                            : t('generationOf', { generation: gen })}
                        </h3>
                        <div className='h-px flex-1 bg-stone-200'></div>
                      </div>
                      <div className='space-y-9'>
                        {Array.from(familiesMap.values()).map(
                          (famPersons, idx) => (
                            // Off-screen families skip rendering. The top padding keeps the
                            // parent label (positioned above the card) inside the
                            // paint-contained box so it isn't clipped.
                            <div
                              key={idx}
                              className='pt-3 [contain-intrinsic-size:auto_480px] [content-visibility:auto]'>
                              <div className='relative rounded-[2.5rem] border border-stone-300 bg-surface p-5 sm:p-8'>
                                {(() => {
                                  const firstBloodline =
                                    famPersons.find((p) => !p.is_in_law) ||
                                    famPersons[0]
                                  const parentIds =
                                    parentsOf.get(firstBloodline.id) || []
                                  const parents = parentIds
                                    .map((id) => personMap.get(id))
                                    .filter(Boolean) as Person[]
                                  const parentNames = parents
                                    .map((p) =>
                                      p.full_name
                                        .trim()
                                        .split(' ')
                                        .splice(-2)
                                        .join(' ')
                                    )
                                    .join(' & ')

                                  const label = parentNames
                                    ? t('childOf', { parents: parentNames })
                                    : familiesMap.size > 1
                                      ? t('familyNumber', { number: idx + 1 })
                                      : null

                                  if (!label) return null

                                  return (
                                    <div className='absolute -top-3 left-8 z-20 rounded-full border border-stone-300 bg-stone-100 px-3 py-0.5 text-sm font-medium text-stone-600'>
                                      {label}
                                    </div>
                                  )
                                })()}
                                <div
                                  className={`grid grid-cols-1 gap-x-6 gap-y-10 md:grid-cols-2 lg:grid-cols-3`}>
                                  {(() => {
                                    // Group famPersons into couple groups strictly by spouse relationships
                                    const coupleGroups: Person[][] = []
                                    const placed = new Set<string>()

                                    for (const p of famPersons) {
                                      if (placed.has(p.id)) continue
                                      const group = [p]
                                      placed.add(p.id)

                                      // Find all spouses connected to this person
                                      const queue = [p.id]
                                      while (queue.length > 0) {
                                        const curr = queue.shift()!
                                        const spIds = spousesOf.get(curr) || []
                                        for (const spId of spIds) {
                                          if (!placed.has(spId)) {
                                            const spObj = famPersons.find(
                                              (m) => m.id === spId
                                            )
                                            if (spObj) {
                                              group.push(spObj)
                                              placed.add(spId)
                                              queue.push(spId)
                                            }
                                          }
                                        }
                                      }

                                      // Balanced Sort: Place bloodline members in the center
                                      // This ensures HUB -- SPOUSE links work best in a horizontal grid.
                                      const bloodlineMembers = group
                                        .filter((m) => !m.is_in_law)
                                        .sort(
                                          (a, b) =>
                                            (a.birth_year || 0) -
                                            (b.birth_year || 0)
                                        )
                                      const inLawMembers = group
                                        .filter((m) => m.is_in_law)
                                        .sort(
                                          (a, b) =>
                                            (a.birth_year || 0) -
                                            (b.birth_year || 0)
                                        )

                                      const balanced: Person[] = []
                                      if (group.length <= 2) {
                                        balanced.push(
                                          ...bloodlineMembers,
                                          ...inLawMembers
                                        )
                                      } else {
                                        // For 3+ people, put the main person(s) in the middle
                                        // Example for 3: [InLaw 1, Bloodline, InLaw 2]
                                        let bIdx = 0
                                        let iIdx = 0
                                        const slots = new Array(group.length)

                                        // Put bloodline in center or near center
                                        const mid = Math.floor(group.length / 2)
                                        slots[mid] = bloodlineMembers[bIdx++]

                                        // Distribute others around
                                        let offset = 1
                                        while (
                                          bIdx < bloodlineMembers.length ||
                                          iIdx < inLawMembers.length
                                        ) {
                                          const next =
                                            bIdx < bloodlineMembers.length
                                              ? bloodlineMembers[bIdx++]
                                              : inLawMembers[iIdx++]
                                          if (
                                            mid + offset < group.length &&
                                            !slots[mid + offset]
                                          )
                                            slots[mid + offset] = next
                                          else if (
                                            mid - offset >= 0 &&
                                            !slots[mid - offset]
                                          )
                                            slots[mid - offset] = next
                                          else {
                                            // Find first empty slot
                                            const empty = slots.findIndex(
                                              (s) => !s
                                            )
                                            if (empty !== -1)
                                              slots[empty] = next
                                          }
                                          offset++
                                        }
                                        balanced.push(
                                          ...slots.filter((s) => !!s)
                                        )
                                      }

                                      coupleGroups.push(balanced)
                                    }
                                    return coupleGroups.map((group, gIdx) => {
                                      const isCouple = group.length > 1
                                      const colSpanClass =
                                        group.length === 2
                                          ? 'md:col-span-2'
                                          : group.length >= 3
                                            ? 'md:col-span-2 lg:col-span-3'
                                            : 'col-span-1'
                                      const innerGridClass =
                                        group.length === 2
                                          ? 'md:grid-cols-2'
                                          : group.length >= 3
                                            ? 'md:grid-cols-2 lg:grid-cols-3'
                                            : 'grid-cols-1'

                                      return (
                                        <div
                                          key={gIdx}
                                          className={`relative ${colSpanClass}`}>
                                          {isCouple && (
                                            <>
                                              {/* Desktop & Tablet background */}
                                              <div className='absolute -inset-3 z-0 hidden rounded-4xl border border-amber-200/80 bg-amber-50/70 md:block lg:-inset-4'></div>
                                              {/* Mobile background */}
                                              <div className='absolute -inset-2 z-0 rounded-3xl border border-amber-200/80 bg-amber-50/70 md:hidden'></div>
                                            </>
                                          )}
                                          <div
                                            className={`relative z-10 grid grid-cols-1 ${innerGridClass} h-full gap-y-6 md:gap-x-6`}>
                                            {group.map((person, pIdx) => (
                                              <div
                                                key={person.id}
                                                className='relative flex h-full flex-col'>
                                                <PersonCard person={person} />
                                                {/* Visual link between spouses (desktop >= md) */}
                                                {isCouple &&
                                                  pIdx < group.length - 1 && (
                                                    <div className='absolute top-[50%] -right-3 z-10 hidden h-0.5 w-6 translate-x-1/2 bg-amber-300 md:block'></div>
                                                  )}
                                                {/* Visual link between spouses (mobile < md) */}
                                                {isCouple &&
                                                  pIdx < group.length - 1 && (
                                                    <div className='absolute -bottom-6 left-1/2 z-10 h-6 w-0.5 -translate-x-1/2 bg-amber-300 md:hidden'></div>
                                                  )}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )
                                    })
                                  })()}
                                </div>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )
                })}
            </div>
          ) : (
            <div className='grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3'>
              {sortedPersons.map((person) => (
                <div
                  key={person.id}
                  className='[contain-intrinsic-size:auto_120px] [content-visibility:auto]'>
                  <PersonCard person={person} />
                </div>
              ))}
            </div>
          )
        ) : (
          <div className='flex flex-col items-center gap-3 py-12 text-center'>
            <p className='text-sm text-stone-500'>
              {initialPersons.length > 0
                ? t('noMatchingMembers')
                : t('noMembers')}
            </p>
            {initialPersons.length > 0 &&
              (searchTerm || filterOption !== 'all') && (
                <button
                  type='button'
                  onClick={() => {
                    setSearchTerm('')
                    setFilterOption('all')
                  }}
                  className='btn'>
                  {t('clearFilters')}
                </button>
              )}
            {initialPersons.length === 0 && canEdit && (
              <button
                type='button'
                onClick={() => setShowCreateMember(true)}
                className='btn-primary'>
                <Plus className='size-4' strokeWidth={2.5} />
                {t('addMember')}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}
