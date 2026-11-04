'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useCallback, useContext, useEffect, useState } from 'react'

import {
  MemberListContext,
  useMemberListView
} from '@/context/MemberListContext'
import { branchesMessages } from '@/lib/i18n/branches'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { Person, RelationshipType } from '@/types'
import { getAvatarUrl } from '@/utils/avatar'
import { formatDisplayDate } from '@/utils/dateHelpers'
import { getAvatarBg } from '@/utils/styleHelprs'
import { createClient } from '@/utils/supabase/client'

import DefaultAvatar from './DefaultAvatar'

function isValidQuickBirthDate(year: string, month: string, day: string) {
  const validPart = (value: string, max: number) =>
    value === '' ||
    (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max)
  if (!validPart(year, 9999) || !validPart(month, 12) || !validPart(day, 31))
    return false
  if (month && day) {
    // An unknown year allows February 29 without inventing a birth year.
    const date = new Date(0)
    date.setFullYear(Number(year || 2000), Number(month), 0)
    return Number(day) <= date.getDate()
  }
  return true
}

interface RelationshipManagerProps {
  person: Person
  isAdmin: boolean
  canEdit?: boolean
  onStatsLoaded?: (stats: {
    biologicalChildren: number
    maleBiologicalChildren: number
    femaleBiologicalChildren: number
    paternalGrandchildren: number
    maternalGrandchildren: number
    sonInLaw: number
    daughterInLaw: number
  }) => void
}

interface EnrichedRelationship {
  id: string
  familyBranchId?: string | null
  type: RelationshipType
  direction: 'parent' | 'child' | 'spouse' | 'child_in_law'
  targetPerson: Person
  note: string | null
}

export default function RelationshipManager({
  person,
  isAdmin,
  canEdit = false,
  onStatsLoaded
}: RelationshipManagerProps) {
  const { t, locale } = useI18n()
  const supabase = createClient()
  const memberListContext = useContext(MemberListContext)
  const { setMemberModalId } = useMemberListView()
  const router = useRouter()

  const personId = person.id
  const personGender = person.gender

  // If inside DashboardProvider → open modal; otherwise → navigate to full page
  const handlePersonClick = (id: string) => {
    if (memberListContext !== undefined) {
      setMemberModalId(id)
    } else {
      router.push(`/dashboard/members/${id}`)
    }
  }

  const [relationships, setRelationships] = useState<EnrichedRelationship[]>([])
  const [loading, setLoading] = useState(true)

  // Add Relationship State
  const [isAdding, setIsAdding] = useState(false)
  const [newRelType, setNewRelType] =
    useState<RelationshipType>('biological_child')
  const [newRelDirection, setNewRelDirection] = useState<
    'parent' | 'child' | 'spouse'
  >('parent')
  const [newRelNote, setNewRelNote] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<Person[]>([])
  const [recentMembers, setRecentMembers] = useState<Person[]>([])
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Bulk Add State
  const [isAddingBulk, setIsAddingBulk] = useState(false)
  const [selectedSpouseId, setSelectedSpouseId] = useState<string>('')
  const [bulkChildren, setBulkChildren] = useState<
    {
      name: string
      gender: 'male' | 'female' | 'other'
      birthYear: string
      birthMonth: string
      birthDay: string
      birthOrder: string
      isProcessing: boolean
    }[]
  >([
    {
      name: '',
      gender: 'male',
      birthYear: '',
      birthMonth: '',
      birthDay: '',
      birthOrder: '1',
      isProcessing: false
    }
  ])

  // Quick Add Spouse State
  const [isAddingSpouse, setIsAddingSpouse] = useState(false)
  const [newSpouseName, setNewSpouseName] = useState('')
  const [newSpouseBirthYear, setNewSpouseBirthYear] = useState('')
  const [newSpouseBirthMonth, setNewSpouseBirthMonth] = useState('')
  const [newSpouseBirthDay, setNewSpouseBirthDay] = useState('')
  const [newSpouseNote, setNewSpouseNote] = useState('')

  // Fetch relationships
  const fetchRelationships = useCallback(async () => {
    try {
      // Get all relationships where this person involved
      // This is a bit complex because we need to check both a and b columns
      const [{ data: relsA, error: errA }, { data: relsB, error: errB }] =
        await Promise.all([
          supabase
            .from('relationships')
            .select(`*, target:persons!person_b(*)`) // if I am A, target is B
            .eq('person_a', personId),
          supabase
            .from('relationships')
            .select(`*, target:persons!person_a(*)`) // if I am B, target is A
            .eq('person_b', personId)
        ])

      if (errA || errB) throw errA || errB

      const formattedRels: EnrichedRelationship[] = []

      // Process Rels where I am Person A
      relsA?.forEach((r) => {
        // RLS already limits these rows to branches the viewer may read.
        // A shared main-family profile can have parents in an auxiliary branch.
        if (!r.target) return
        let direction: 'parent' | 'child' | 'spouse' = 'spouse'
        if (r.type === 'marriage') direction = 'spouse'
        else if (r.type === 'biological_child' || r.type === 'adopted_child')
          direction = 'child' // I am A (Parent), B is Child

        formattedRels.push({
          id: r.id,
          familyBranchId: r.family_branch_id,
          type: r.type,
          direction,
          targetPerson: r.target,
          note: r.note
        })
      })

      // Process Rels where I am Person B
      relsB?.forEach((r) => {
        if (!r.target) return
        let direction: 'parent' | 'child' | 'spouse' = 'spouse'
        if (r.type === 'marriage') direction = 'spouse'
        else if (r.type === 'biological_child' || r.type === 'adopted_child')
          direction = 'parent' // I am B (Child), A is Parent

        formattedRels.push({
          id: r.id,
          familyBranchId: r.family_branch_id,
          type: r.type,
          direction,
          targetPerson: r.target,
          note: r.note
        })
      })

      // Fetch in-laws (spouses of children)
      const childrenIds = formattedRels
        .filter((r) => r.direction === 'child')
        .map((r) => r.targetPerson.id)

      if (childrenIds.length > 0) {
        const { data: childrenMarriages } = await supabase
          .from('relationships')
          .select(
            `*, person_a_data:persons!person_a(*), person_b_data:persons!person_b(*)`
          )
          .eq('type', 'marriage')
          .or(
            `person_a.in.(${childrenIds.join(',')}),person_b.in.(${childrenIds.join(',')})`
          )

        if (childrenMarriages) {
          childrenMarriages.forEach((m) => {
            const isAChild = childrenIds.includes(m.person_a)
            const childPerson = isAChild ? m.person_a_data : m.person_b_data
            const spousePerson = isAChild ? m.person_b_data : m.person_a_data

            if (spousePerson && childPerson) {
              const spouseGender = spousePerson.gender
              let noteLabel = t('spouseOf', { name: childPerson.full_name })
              if (spouseGender === 'female')
                noteLabel = t('daughterInLawOf', {
                  name: childPerson.full_name
                })
              if (spouseGender === 'male')
                noteLabel = t('sonInLawOf', { name: childPerson.full_name })

              // Append existing marriage note if any
              if (m.note) noteLabel += ` - ${m.note}`

              formattedRels.push({
                id: m.id + '_inlaw',
                familyBranchId: m.family_branch_id,
                type: 'marriage',
                direction: 'child_in_law',
                targetPerson: spousePerson,
                note: noteLabel
              })
            }
          })
        }
      }

      // The same relation can be stored in multiple readable scopes. Prefer
      // the main-family row so each relative appears and is counted once.
      const unique = new Map<string, EnrichedRelationship>()
      for (const relation of formattedRels) {
        const key = `${relation.direction}:${relation.type}:${relation.targetPerson.id}`
        if (!unique.has(key) || !relation.familyBranchId)
          unique.set(key, relation)
      }
      const visibleRelationships = [...unique.values()]

      if (onStatsLoaded) {
        const biologicalChildrenList = visibleRelationships.filter(
          (r) => r.direction === 'child' && r.type === 'biological_child'
        )
        const biologicalChildren = biologicalChildrenList.length
        const maleBiologicalChildren = biologicalChildrenList.filter(
          (c) => c.targetPerson.gender === 'male'
        ).length
        const femaleBiologicalChildren = biologicalChildrenList.filter(
          (c) => c.targetPerson.gender === 'female'
        ).length

        const daughterInLaw = visibleRelationships.filter(
          (r) =>
            r.direction === 'child_in_law' && r.targetPerson.gender === 'female'
        ).length
        const sonInLaw = visibleRelationships.filter(
          (r) =>
            r.direction === 'child_in_law' && r.targetPerson.gender === 'male'
        ).length

        // Fetch Grandchildren mapping
        let paternalGrandchildren = 0
        let maternalGrandchildren = 0
        if (childrenIds.length > 0) {
          const { data: grandchildrenData } = await supabase
            .from('relationships')
            .select('*')
            .in('type', ['biological_child', 'adopted_child'])
            .in('person_a', childrenIds)

          if (grandchildrenData) {
            const maleChildrenIds = visibleRelationships
              .filter(
                (r) =>
                  r.direction === 'child' && r.targetPerson.gender === 'male'
              )
              .map((r) => r.targetPerson.id)
            const femaleChildrenIds = visibleRelationships
              .filter(
                (r) =>
                  r.direction === 'child' && r.targetPerson.gender === 'female'
              )
              .map((r) => r.targetPerson.id)

            paternalGrandchildren = new Set(
              grandchildrenData
                .filter((g) => maleChildrenIds.includes(g.person_a))
                .map((g) => g.person_b)
            ).size
            maternalGrandchildren = new Set(
              grandchildrenData
                .filter((g) => femaleChildrenIds.includes(g.person_a))
                .map((g) => g.person_b)
            ).size
          }
        }

        onStatsLoaded({
          biologicalChildren,
          maleBiologicalChildren,
          femaleBiologicalChildren,
          paternalGrandchildren,
          maternalGrandchildren,
          sonInLaw,
          daughterInLaw
        })
      }

      setRelationships(visibleRelationships)
    } catch (err) {
      console.error('Error fetching relationships:', err)
    } finally {
      setLoading(false)
    }
  }, [personId, supabase, onStatsLoaded, t])

  useEffect(() => {
    const timeoutId = window.setTimeout(fetchRelationships, 0)
    return () => window.clearTimeout(timeoutId)
  }, [fetchRelationships])

  // Search for people to add
  useEffect(() => {
    const searchPeople = async () => {
      if (searchTerm.length < 2) {
        setSearchResults([])
        return
      }

      const { data } = await supabase
        .from('persons')
        .select('*')
        .ilike('full_name', `%${searchTerm}%`)
        .neq('id', personId) // Exclude self
        .limit(5)

      if (data)
        setSearchResults(data.filter((person) => !person.family_branch_id))
    }

    const timeoutId = setTimeout(searchPeople, 300)
    return () => clearTimeout(timeoutId)
  }, [searchTerm, personId, supabase])

  // Fetch recent members when opening Add form
  useEffect(() => {
    if (isAdding && recentMembers.length === 0) {
      const fetchRecent = async () => {
        const { data } = await supabase
          .from('persons')
          .select('*')
          .neq('id', personId)
          .order('created_at', { ascending: false })
          .limit(10)
        if (data)
          setRecentMembers(data.filter((person) => !person.family_branch_id))
      }
      fetchRecent()
    }
  }, [isAdding, personId, supabase, recentMembers.length])

  const handleAddRelationship = async () => {
    if (!selectedTargetId) return
    setProcessing(true)
    setError(null)

    try {
      let personA = personId
      let personB = selectedTargetId
      // Default: I am A, Target is B.

      // Setup payload based on logic
      // Marriage: Order doesn't strictly matter logically, but consistency is good.
      // Parent/Child:
      //    Relationship Type: biological_child
      //    Column A: Parent
      //    Column B: Child

      if (newRelDirection === 'parent') {
        // Target is Parent (A), I am Child (B)
        personA = selectedTargetId
        personB = personId
      } else if (newRelDirection === 'child') {
        // I am Parent (A), Target is Child (B)
        personA = personId
        personB = selectedTargetId
      }

      // Determine Type
      let type: RelationshipType = 'biological_child'
      if (newRelDirection === 'spouse') type = 'marriage'
      else if (newRelType === 'adopted_child') type = 'adopted_child'

      const { error } = await supabase.from('relationships').insert({
        person_a: personA,
        person_b: personB,
        type: type,
        note: newRelNote ? newRelNote : null
      })

      if (error) throw error

      // Auto-update target person generation and is_in_law if currently missing
      try {
        const { data: targetPerson } = await supabase
          .from('persons')
          .select('generation, is_in_law')
          .eq('id', selectedTargetId)
          .single()

        if (
          targetPerson &&
          (targetPerson.generation == null || targetPerson.is_in_law == null)
        ) {
          const updates: { generation?: number; is_in_law?: boolean } = {}

          if (targetPerson.generation == null && person.generation != null) {
            if (newRelDirection === 'child')
              updates.generation = person.generation + 1
            else if (newRelDirection === 'parent')
              updates.generation = person.generation - 1
            else if (newRelDirection === 'spouse')
              updates.generation = person.generation
          }

          if (targetPerson.is_in_law == null) {
            if (newRelDirection === 'child' || newRelDirection === 'parent')
              updates.is_in_law = false
            else if (newRelDirection === 'spouse')
              updates.is_in_law = person.is_in_law === true ? false : true
          }

          if (Object.keys(updates).length > 0) {
            await supabase
              .from('persons')
              .update(updates)
              .eq('id', selectedTargetId)
          }
        }
      } catch (err) {
        console.error('Failed to auto-update target person properties', err)
      }

      setIsAdding(false)
      setSearchTerm('')
      setSelectedTargetId(null)
      setNewRelNote('')
      fetchRelationships()
      router.refresh()
    } catch (err: unknown) {
      const e = err as Error
      setError(
        e.message === 'ancestry_cycle'
          ? t('lineageCycleError')
          : t('relationshipAddError', { error: e.message })
      )
      setTimeout(() => setError(null), 5000)
    } finally {
      setProcessing(false)
    }
  }

  const handleBulkAdd = async () => {
    // Filter out rows without a name
    const validChildren = bulkChildren.filter((c) => c.name.trim() !== '')
    if (validChildren.length === 0) {
      setError(t('childNameRequired'))
      setTimeout(() => setError(null), 5000)
      return
    }

    if (
      validChildren.some(
        (child) =>
          !isValidQuickBirthDate(
            child.birthYear,
            child.birthMonth,
            child.birthDay
          )
      )
    ) {
      setError(t('invalidBirthDate'))
      return
    }

    setProcessing(true)
    setError(null)
    try {
      const { error: addError } = await supabase.rpc('add_family_children', {
        parent_id: personId,
        other_parent_id:
          selectedSpouseId && selectedSpouseId !== 'unknown'
            ? selectedSpouseId
            : null,
        children: validChildren.map((child) => ({
          full_name: child.name.trim(),
          gender: child.gender,
          birth_year: child.birthYear === '' ? null : Number(child.birthYear),
          birth_month:
            child.birthMonth === '' ? null : Number(child.birthMonth),
          birth_day: child.birthDay === '' ? null : Number(child.birthDay),
          birth_order: child.birthOrder === '' ? null : Number(child.birthOrder)
        }))
      })
      if (addError) throw addError

      setIsAddingBulk(false)
      setBulkChildren([
        {
          name: '',
          gender: 'male',
          birthYear: '',
          birthMonth: '',
          birthDay: '',
          birthOrder: '1',
          isProcessing: false
        }
      ])
      setSelectedSpouseId('')
      fetchRelationships()
      router.refresh()
    } catch (err: unknown) {
      const e = err as Error
      setError(t('bulkAddError', { error: e.message }))
      setTimeout(() => setError(null), 5000)
    } finally {
      setProcessing(false)
    }
  }

  const handleQuickAddSpouse = async () => {
    if (!newSpouseName.trim()) {
      setError(t('spouseNameRequired'))
      setTimeout(() => setError(null), 5000)
      return
    }

    if (
      !isValidQuickBirthDate(
        newSpouseBirthYear,
        newSpouseBirthMonth,
        newSpouseBirthDay
      )
    ) {
      setError(t('invalidBirthDate'))
      return
    }

    setProcessing(true)
    setError(null)
    try {
      // Determine default gender based on current person defined in personGender prop
      // Default to opposite. If original is other, default to female (arbitrary choice, or let user pick, but standard says opposite)
      const newSpouseGender =
        personGender === 'male'
          ? 'female'
          : personGender === 'female'
            ? 'male'
            : 'female'

      const personPayload: {
        full_name: string
        gender: 'male' | 'female' | 'other'
        birth_year?: number
        birth_month?: number
        birth_day?: number
        is_in_law?: boolean
        generation?: number
      } = {
        full_name: newSpouseName.trim(),
        gender: newSpouseGender,
        is_in_law: person.is_in_law === true ? false : true
      }

      if (person.generation != null) {
        personPayload.generation = person.generation
      }

      if (newSpouseBirthYear.trim() !== '') {
        const year = parseInt(newSpouseBirthYear)
        if (!isNaN(year)) personPayload.birth_year = year
      }

      if (newSpouseBirthMonth !== '')
        personPayload.birth_month = Number(newSpouseBirthMonth)
      if (newSpouseBirthDay !== '')
        personPayload.birth_day = Number(newSpouseBirthDay)

      // 1. Insert Person
      const { data: newPersonData, error: insertError } = await supabase
        .from('persons')
        .insert(personPayload)
        .select('id')
        .single()

      if (insertError || !newPersonData) throw insertError

      const newSpouseId = newPersonData.id

      // 2. Insert Marriage Relationship
      const { error: relError } = await supabase.from('relationships').insert({
        person_a: personId,
        person_b: newSpouseId,
        type: 'marriage',
        note: newSpouseNote.trim() || null
      })

      if (relError) throw relError

      setIsAddingSpouse(false)
      setNewSpouseName('')
      setNewSpouseBirthYear('')
      setNewSpouseBirthMonth('')
      setNewSpouseBirthDay('')
      setNewSpouseNote('')
      fetchRelationships()
      router.refresh()
    } catch (err: unknown) {
      const e = err as Error
      setError(t('spouseAddError', { error: e.message }))
      setTimeout(() => setError(null), 5000)
    } finally {
      setProcessing(false)
    }
  }

  const handleDelete = async (relId: string) => {
    if (!confirm(t('confirmDeleteRelationship'))) return
    try {
      const { error } = await supabase
        .from('relationships')
        .delete()
        .eq('id', relId)
        .is('family_branch_id', null)
      if (error) throw error
      fetchRelationships()
      router.refresh()
    } catch (err: unknown) {
      const e = err as Error
      setError(t('deleteRelationshipError', { error: e.message }))
      setTimeout(() => setError(null), 5000)
    }
  }

  const groupByType = (type: string) => {
    const items = relationships.filter((r) => r.direction === type)

    // Nếu là nhóm con cái → sắp xếp theo birth_order
    if (type === 'child') {
      return items.sort((a, b) => {
        const orderA = a.targetPerson.birth_order
        const orderB = b.targetPerson.birth_order

        if (orderA != null && orderB != null) {
          return orderA - orderB
        }

        if (orderA != null) return -1
        if (orderB != null) return 1

        return (
          (a.targetPerson.birth_year ?? 9999) -
          (b.targetPerson.birth_year ?? 9999)
        )
      })
    }

    return items
  }

  if (loading)
    return (
      <div className='text-sm text-stone-500'>{t('loadingFamilyInfo')}</div>
    )

  return (
    <div className='space-y-6'>
      {/* List Sections */}
      {['parent', 'spouse', 'child', 'child_in_law'].map((group) => {
        const items = groupByType(group)
        let title = ''
        if (group === 'parent') title = t('relationParent')
        if (group === 'spouse') title = t('relationSpouse')
        if (group === 'child') title = t('relationChildren')
        if (group === 'child_in_law') title = t('relationInLawChildren')

        if (items.length === 0 && !isAdmin) return null // Hide empty sections for members? Or show empty state?

        return (
          <div
            key={group}
            className='border-b border-stone-100 pb-4 last:border-0'>
            <h4 className='mb-3 flex items-center justify-between text-base font-semibold text-stone-700'>
              {title}
            </h4>
            {items.length > 0 ? (
              <ul className='space-y-3'>
                {items.map((rel) => (
                  <li
                    key={rel.id}
                    className='group flex items-center justify-between'>
                    <button
                      onClick={() => handlePersonClick(rel.targetPerson.id)}
                      className='-mx-2.5 flex flex-1 items-center gap-3 rounded-xl p-2.5 text-left transition-all duration-200 hover:bg-stone-100'>
                      <div
                        className={`flex size-8 items-center justify-center overflow-hidden rounded-full text-sm text-white ${getAvatarBg(rel.targetPerson.gender)}`}>
                        {getAvatarUrl(rel.targetPerson.avatar_url) ? (
                          <Image
                            unoptimized
                            src={getAvatarUrl(rel.targetPerson.avatar_url)!}
                            alt={rel.targetPerson.full_name}
                            className='h-full w-full object-cover'
                            width={32}
                            height={32}
                          />
                        ) : (
                          <DefaultAvatar
                            gender={rel.targetPerson.gender}
                            size={32}
                          />
                        )}
                      </div>
                      <div className='flex flex-col'>
                        <span className='text-sm font-medium text-stone-900'>
                          {rel.targetPerson.full_name}
                        </span>
                        {rel.note && (
                          <span className='mt-0.5 text-sm font-medium text-amber-600 italic'>
                            ({rel.note})
                          </span>
                        )}
                        {rel.type === 'adopted_child' && (
                          <span className='mt-0.5 text-sm text-stone-400 italic'>
                            ({t('adoptedChild')})
                          </span>
                        )}
                        {rel.familyBranchId && (
                          <span className='mt-0.5 text-sm text-secondary'>
                            {branchesMessages[locale].title}
                          </span>
                        )}
                      </div>
                    </button>
                    {canEdit &&
                      !rel.familyBranchId &&
                      rel.direction !== 'child_in_law' && (
                        <button
                          onClick={() => handleDelete(rel.id)}
                          className='ml-2 flex items-center justify-center rounded-lg p-2 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500 sm:p-2.5'
                          title={t('deleteRelationship')}
                          aria-label={t('deleteRelationship')}>
                          <svg
                            xmlns='http://www.w3.org/2000/svg'
                            width='16'
                            height='16'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='2'
                            strokeLinecap='round'
                            strokeLinejoin='round'>
                            <path d='M3 6h18' />
                            <path d='M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' />
                            <path d='M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' />
                            <line x1='10' x2='10' y1='11' y2='17' />
                            <line x1='14' x2='14' y1='11' y2='17' />
                          </svg>
                        </button>
                      )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className='text-sm text-stone-400 italic'>
                {t('noFamilyInfo')}
              </p>
            )}
          </div>
        )
      })}

      {/* Add Button (Admin) */}
      {canEdit && !isAdding && !isAddingBulk && !isAddingSpouse && (
        <div className='mt-4 flex flex-col gap-3 sm:flex-row'>
          <button
            onClick={() => setIsAdding(true)}
            className='flex-1 rounded-xl border-2 border-dashed border-stone-200 bg-stone-50/50 py-3 text-sm font-medium text-stone-500 transition-all duration-200 hover:border-amber-400 hover:bg-stone-50 hover:text-amber-700 sm:rounded-2xl'>
            + {t('addRelationship')}
          </button>

          <button
            onClick={() => setIsAddingBulk(true)}
            className='flex-1 rounded-xl border-2 border-dashed border-stone-200 bg-stone-50/50 py-3 text-sm font-medium text-stone-500 transition-all duration-200 hover:border-sky-400 hover:bg-stone-50 hover:text-sky-700 sm:rounded-2xl'>
            + {t('addChildren')}
          </button>

          <button
            onClick={() => setIsAddingSpouse(true)}
            className='flex-1 rounded-xl border-2 border-dashed border-stone-200 bg-stone-50/50 py-3 text-sm font-medium text-stone-500 transition-all duration-200 hover:border-rose-400 hover:bg-stone-50 hover:text-rose-700 sm:rounded-2xl'>
            + {t('addSpouse')}
          </button>
        </div>
      )}

      {error && !isAdding && !isAddingBulk && !isAddingSpouse && (
        <div className='animate-in fade-in slide-in-from-top-2 mt-4 flex items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-600'>
          <div className='flex items-center gap-2'>
            <svg
              className='h-5 w-5 shrink-0 text-red-500'
              fill='none'
              viewBox='0 0 24 24'
              stroke='currentColor'>
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
              />
            </svg>
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className='p-1 text-red-400 transition-colors hover:text-red-600'>
            <svg
              className='h-4 w-4'
              fill='none'
              viewBox='0 0 24 24'
              stroke='currentColor'>
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M6 18L18 6M6 6l12 12'
              />
            </svg>
          </button>
        </div>
      )}

      {/* Add Form (Admin) */}
      {canEdit && isAdding && (
        <div className='mt-4 rounded-xl border border-stone-200 bg-stone-50/50 p-4 sm:p-5'>
          <h4 className='mb-3 text-base font-semibold text-stone-800'>
            {t('relationshipAddTitle')}
          </h4>

          <div className='space-y-3'>
            <div>
              <label
                htmlFor='rel-note'
                className='mb-1 block text-sm font-medium text-stone-600'>
                {t('relationshipNote')}
              </label>
              <input
                id='rel-note'
                name='rel-note'
                type='text'
                placeholder={t('relationshipNotePlaceholder')}
                value={newRelNote}
                onChange={(e) => setNewRelNote(e.target.value)}
                className='mb-3 block w-full rounded-lg border border-stone-300 bg-surface p-2 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-amber-500 focus:ring-amber-500 sm:p-2.5'
              />
            </div>

            <div>
              <label
                htmlFor='rel-direction'
                className='mb-1 block text-sm font-medium text-stone-600'>
                {t('relationshipType')}
              </label>
              <select
                id='rel-direction'
                name='rel-direction'
                value={newRelDirection}
                onChange={(e) =>
                  setNewRelDirection(
                    e.target.value as 'parent' | 'child' | 'spouse'
                  )
                }
                className='block w-full max-w-full rounded-lg border border-stone-300 bg-surface p-2 text-sm text-stone-900 transition-colors focus:border-amber-500 focus:ring-amber-500 sm:p-2.5'>
                <option value='parent'>{t('relationParentOption')}</option>
                <option value='spouse'>{t('relationSpouseOption')}</option>
                <option value='child'>{t('relationChildOption')}</option>
              </select>
            </div>

            {/* Child Type Sub-selection */}
            {(newRelDirection === 'child' || newRelDirection === 'parent') && (
              <div>
                <label
                  htmlFor='rel-type'
                  className='mb-1 block text-sm font-medium text-stone-600'>
                  {t('relationshipDetails')}
                </label>
                <select
                  id='rel-type'
                  name='rel-type'
                  value={newRelType}
                  onChange={(e) =>
                    setNewRelType(e.target.value as RelationshipType)
                  }
                  className='block w-full max-w-full rounded-lg border border-stone-300 bg-surface p-2 text-sm text-stone-900 transition-colors focus:border-amber-500 focus:ring-amber-500 sm:p-2.5'>
                  <option value='biological_child'>
                    {t('biologicalChild')}
                  </option>
                  <option value='adopted_child'>{t('adoptedChild')}</option>
                </select>
              </div>
            )}

            <div>
              <label
                htmlFor='rel-search'
                className='mb-1 block text-sm font-medium text-stone-600'>
                {t('searchRelative')}
              </label>
              <input
                id='rel-search'
                name='rel-search'
                type='text'
                placeholder={t('searchRelativePlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className='block w-full rounded-lg border border-stone-300 bg-surface p-2 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-amber-500 focus:ring-amber-500 sm:p-2.5'
              />
              {/* Search Results Dropdown */}
              {(searchResults.length > 0 ||
                (searchTerm.length === 0 &&
                  !selectedTargetId &&
                  recentMembers.length > 0)) && (
                <div className='mt-2 max-h-62.5 overflow-y-auto rounded-md border border-stone-200 bg-surface'>
                  <div className='sticky top-0 z-10 border-b border-stone-200 bg-stone-100 px-3 py-1.5 text-sm font-medium text-stone-500'>
                    {searchResults.length > 0
                      ? t('searchResults')
                      : t('recentMembers')}
                  </div>
                  {(searchResults.length > 0
                    ? searchResults
                    : recentMembers
                  ).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelectedTargetId(p.id)
                        setSearchTerm(p.full_name)
                        setSearchResults([])
                      }}
                      className='flex items-center justify-between border-b border-stone-100 px-3 py-2 text-sm last:border-0 hover:bg-amber-50'>
                      <div className='flex items-center gap-2'>
                        <span
                          className={`flex size-3 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white ${
                            p.gender === 'male'
                              ? 'bg-sky-500'
                              : p.gender === 'female'
                                ? 'bg-rose-500'
                                : 'bg-stone-400'
                          }`}>
                          {p.gender === 'male'
                            ? '♂'
                            : p.gender === 'female'
                              ? '♀'
                              : '?'}
                        </span>
                        <span className='font-medium text-stone-800'>
                          {p.full_name}
                        </span>
                      </div>
                      <span className='text-sm text-stone-400'>
                        {formatDisplayDate(
                          p.birth_year,
                          p.birth_month,
                          p.birth_day,
                          p.birth_year_from,
                          p.birth_year_to
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {selectedTargetId && (
                <p className='mt-1 text-sm text-green-600'>
                  {t('selectedPerson', { name: searchTerm })}
                </p>
              )}
            </div>

            <div className='flex gap-2 pt-2'>
              <button
                onClick={handleAddRelationship}
                disabled={!selectedTargetId || processing}
                className='flex-1 rounded-md bg-amber-700 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-800 disabled:opacity-50 sm:rounded-lg sm:py-2.5'>
                {processing ? t('saving') : t('save')}
              </button>
              <button
                onClick={() => {
                  setIsAdding(false)
                  setSelectedTargetId(null)
                  setSearchTerm('')
                  setNewRelNote('')
                }}
                className='rounded-md border border-stone-300 bg-surface px-4 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-50 sm:rounded-lg sm:py-2.5'>
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Add Children Form (Admin) */}
      {canEdit && isAddingBulk && (
        <div className='mt-4 rounded-xl border border-sky-200 bg-sky-50/50 p-4 sm:p-5'>
          <h4 className='mb-3 text-base font-semibold text-sky-800'>
            {t('addBulkChildren')}
          </h4>

          <div className='space-y-4'>
            <div>
              <label
                htmlFor='bulk-spouse'
                className='mb-1 block text-sm font-medium text-stone-600'>
                {t('otherParent')}
              </label>
              <select
                id='bulk-spouse'
                name='bulk-spouse'
                value={selectedSpouseId}
                onChange={(e) => setSelectedSpouseId(e.target.value)}
                className='block w-full max-w-full rounded-lg border border-stone-300 bg-surface p-2 text-sm text-stone-900 transition-colors focus:border-sky-500 focus:ring-sky-500 sm:p-2.5'>
                <option value='unknown'>{t('unknownOtherParent')}</option>
                {groupByType('spouse').map((rel) => (
                  <option key={rel.id} value={rel.targetPerson.id}>
                    {rel.targetPerson.full_name}{' '}
                    {rel.note ? `(${rel.note})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className='space-y-3'>
              <label className='mb-1 block text-sm font-medium text-stone-600'>
                {t('childrenList')}
              </label>
              {bulkChildren.map((child, index) => (
                <div
                  key={index}
                  className='rounded-xl border border-stone-200/80 bg-surface p-3 sm:p-4'>
                  {/* Header: number + remove */}
                  <div className='mb-2.5 flex items-center justify-between'>
                    <span className='rounded-md bg-sky-50 px-2 py-0.5 text-sm font-medium text-sky-600'>
                      {t('nthChild', { count: index + 1 })}
                    </span>
                    <button
                      onClick={() => {
                        const newBulk = bulkChildren.filter(
                          (_, i) => i !== index
                        )
                        if (newBulk.length === 0) {
                          newBulk.push({
                            name: '',
                            gender: 'male',
                            birthYear: '',
                            birthMonth: '',
                            birthDay: '',
                            birthOrder: '1',
                            isProcessing: false
                          })
                        }
                        setBulkChildren(newBulk)
                      }}
                      className='rounded-lg p-1.5 text-sm text-stone-400 transition-colors hover:bg-red-50 hover:text-red-500'
                      title={t('remove')}>
                      ✕
                    </button>
                  </div>
                  {/* Fields */}
                  <div className='flex flex-wrap gap-2'>
                    <input
                      id={`child-birth-order-${index}`}
                      name={`child-birth-order-${index}`}
                      type='number'
                      placeholder={t('birthOrderShort')}
                      min='1'
                      value={child.birthOrder}
                      onChange={(e) => {
                        const newBulk = [...bulkChildren]
                        newBulk[index].birthOrder = e.target.value
                        setBulkChildren(newBulk)
                      }}
                      className='w-14 shrink-0 rounded-lg border border-stone-300 bg-stone-50 px-1 py-2 text-center text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-sky-500 focus:ring-sky-500'
                    />
                    <input
                      id={`child-name-${index}`}
                      name={`child-name-${index}`}
                      type='text'
                      placeholder={t('requiredFullName')}
                      value={child.name}
                      onChange={(e) => {
                        const newBulk = [...bulkChildren]
                        newBulk[index].name = e.target.value
                        setBulkChildren(newBulk)
                      }}
                      className='w-[calc(100%-4rem)] min-w-0 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-sky-500 focus:ring-sky-500 sm:w-auto sm:flex-1'
                    />
                    <select
                      id={`child-gender-${index}`}
                      name={`child-gender-${index}`}
                      value={child.gender}
                      onChange={(e) => {
                        const newBulk = [...bulkChildren]
                        newBulk[index].gender = e.target.value as
                          'male' | 'female' | 'other'
                        setBulkChildren(newBulk)
                      }}
                      className='w-[calc(50%-0.25rem)] shrink-0 rounded-lg border border-stone-300 bg-stone-50 px-2 py-2 text-sm text-stone-900 transition-colors focus:border-sky-500 focus:ring-sky-500 sm:w-24'>
                      <option value='male'>{t('male')}</option>
                      <option value='female'>{t('female')}</option>
                      <option value='other'>{t('otherGender')}</option>
                    </select>
                  </div>
                  <div className='mt-2 grid grid-cols-3 gap-2'>
                    {(
                      [
                        ['birthDay', 'day', 31],
                        ['birthMonth', 'month', 12]
                      ] as const
                    ).map(([field, label, max]) => (
                      <div key={field}>
                        <label
                          htmlFor={`child-${field}-${index}`}
                          className='mb-1 block text-sm font-medium text-secondary'>
                          {t(label)}
                        </label>
                        <input
                          id={`child-${field}-${index}`}
                          name={`child-${field}-${index}`}
                          type='number'
                          min='1'
                          max={max}
                          step='1'
                          placeholder={t(label)}
                          value={child[field]}
                          onChange={(e) =>
                            setBulkChildren((children) =>
                              children.map((row, i) =>
                                i === index
                                  ? { ...row, [field]: e.target.value }
                                  : row
                              )
                            )
                          }
                          className='block w-full min-w-0 rounded-lg border border-border bg-neutral px-2 py-2 text-sm text-primary placeholder:text-secondary focus:border-tertiary focus:ring-tertiary'
                        />
                      </div>
                    ))}
                    <div>
                      <label
                        htmlFor={`child-birth-year-${index}`}
                        className='mb-1 block text-sm font-medium text-secondary'>
                        {t('birthYear')}
                      </label>
                      <input
                        id={`child-birth-year-${index}`}
                        name={`child-birth-year-${index}`}
                        type='number'
                        placeholder={t('birthYear')}
                        min='1'
                        max='9999'
                        value={child.birthYear}
                        onChange={(e) => {
                          const newBulk = [...bulkChildren]
                          newBulk[index].birthYear = e.target.value
                          setBulkChildren(newBulk)
                        }}
                        className='block w-full min-w-0 rounded-lg border border-border bg-neutral px-2 py-2 text-sm text-primary placeholder:text-secondary focus:border-tertiary focus:ring-tertiary'
                      />
                    </div>
                  </div>
                </div>
              ))}

              <button
                onClick={() => {
                  const nextOrder = String(bulkChildren.length + 1)
                  setBulkChildren([
                    ...bulkChildren,
                    {
                      name: '',
                      gender: 'male',
                      birthYear: '',
                      birthMonth: '',
                      birthDay: '',
                      birthOrder: nextOrder,
                      isProcessing: false
                    }
                  ])
                }}
                className='w-full rounded-xl border-2 border-dashed border-sky-200 bg-sky-50/50 py-2.5 text-sm font-medium text-sky-600 transition-all hover:border-sky-300 hover:bg-sky-50'>
                + {t('addRow')}
              </button>
            </div>

            <div className='flex gap-2 border-t border-stone-200 pt-4'>
              <button
                onClick={handleBulkAdd}
                disabled={
                  processing || bulkChildren.every((c) => c.name.trim() === '')
                }
                className='flex-1 rounded-md bg-sky-600 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50 sm:rounded-lg sm:py-2.5'>
                {processing ? t('saving') : t('saveAll')}
              </button>
              <button
                onClick={() => {
                  setIsAddingBulk(false)
                  setBulkChildren([
                    {
                      name: '',
                      gender: 'male',
                      birthYear: '',
                      birthMonth: '',
                      birthDay: '',
                      birthOrder: '1',
                      isProcessing: false
                    }
                  ])
                  setSelectedSpouseId('')
                }}
                className='rounded-md border border-stone-300 bg-surface px-4 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-50 sm:rounded-lg sm:py-2.5'>
                {t('cancel')}
              </button>
            </div>
            {error && (
              <p role='alert' className='text-sm text-error'>
                {error}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Quick Add Spouse Form (Admin) */}
      {canEdit && isAddingSpouse && (
        <div className='mt-4 rounded-xl border border-rose-200 bg-rose-50/50 p-4 sm:p-5'>
          <h4 className='mb-3 text-base font-semibold text-rose-800'>
            {t('addQuickSpouse')}
          </h4>

          <div className='space-y-3'>
            <div>
              <label
                htmlFor='spouse-name'
                className='mb-1 block text-sm font-medium text-stone-600'>
                {t('fullName')} <span className='text-red-500'>*</span>
              </label>
              <input
                id='spouse-name'
                name='spouse-name'
                type='text'
                placeholder={t('fullNamePlaceholder')}
                value={newSpouseName}
                onChange={(e) => setNewSpouseName(e.target.value)}
                className='block w-full rounded-lg border border-stone-300 bg-surface p-2 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-rose-500 focus:ring-rose-500 sm:p-2.5'
              />
            </div>

            <div className='grid grid-cols-3 gap-2'>
              {(
                [
                  ['day', newSpouseBirthDay, setNewSpouseBirthDay, 31],
                  ['month', newSpouseBirthMonth, setNewSpouseBirthMonth, 12]
                ] as const
              ).map(([label, value, setValue, max]) => (
                <div key={label}>
                  <label
                    htmlFor={`spouse-${label}`}
                    className='mb-1 block text-sm font-medium text-secondary'>
                    {t(label)}
                  </label>
                  <input
                    id={`spouse-${label}`}
                    name={`spouse-${label}`}
                    type='number'
                    min='1'
                    max={max}
                    step='1'
                    placeholder={t(label)}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className='block w-full min-w-0 rounded-lg border border-border bg-surface p-2 text-sm text-primary placeholder:text-secondary focus:border-tertiary focus:ring-tertiary sm:p-2.5'
                  />
                </div>
              ))}
              <div>
                <label
                  htmlFor='spouse-birth-year'
                  className='mb-1 block text-sm font-medium text-stone-600'>
                  {t('birthYear')}
                </label>
                <input
                  id='spouse-birth-year'
                  name='spouse-birth-year'
                  type='number'
                  min='1'
                  max='9999'
                  placeholder={t('birthYearExample')}
                  value={newSpouseBirthYear}
                  onChange={(e) => setNewSpouseBirthYear(e.target.value)}
                  className='block w-full rounded-lg border border-stone-300 bg-surface p-2 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-rose-500 focus:ring-rose-500 sm:p-2.5'
                />
              </div>
            </div>

            <div>
              <label
                htmlFor='spouse-note'
                className='mb-1 block text-sm font-medium text-stone-600'>
                {t('relationshipNoteExample')}
              </label>
              <input
                id='spouse-note'
                name='spouse-note'
                type='text'
                placeholder={t('optional')}
                value={newSpouseNote}
                onChange={(e) => setNewSpouseNote(e.target.value)}
                className='block w-full rounded-lg border border-stone-300 bg-surface p-2 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-rose-500 focus:ring-rose-500 sm:p-2.5'
              />
            </div>

            <p className='mt-1 text-sm text-stone-500 italic'>
              {t('autoGenderNote', {
                gender:
                  personGender === 'male'
                    ? t('female')
                    : personGender === 'female'
                      ? t('male')
                      : t('female')
              })}
            </p>

            <div className='flex gap-2 pt-2'>
              <button
                onClick={handleQuickAddSpouse}
                disabled={!newSpouseName.trim() || processing}
                className='flex-1 rounded-md bg-rose-600 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-50 sm:rounded-lg sm:py-2.5'>
                {processing ? t('saving') : t('save')}
              </button>
              <button
                onClick={() => {
                  setIsAddingSpouse(false)
                  setNewSpouseName('')
                  setNewSpouseBirthYear('')
                  setNewSpouseBirthMonth('')
                  setNewSpouseBirthDay('')
                  setNewSpouseNote('')
                }}
                className='rounded-md border border-stone-300 bg-surface px-4 py-2 text-sm text-stone-700 transition-colors hover:bg-stone-50 sm:rounded-lg sm:py-2.5'>
                {t('cancel')}
              </button>
            </div>
            {error && (
              <div className='animate-in fade-in slide-in-from-top-1 mt-2 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600'>
                <svg
                  className='h-4 w-4 shrink-0'
                  fill='none'
                  viewBox='0 0 24 24'
                  stroke='currentColor'>
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                  />
                </svg>
                {error}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
