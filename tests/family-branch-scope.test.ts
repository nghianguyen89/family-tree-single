import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Person, Relationship } from '../types'
import type { FamilyBranch } from '../types/branches'
import { computeEvents } from '../utils/eventHelpers'
import {
  branchFirstGeneration,
  branchTreePreview,
  mainFamilyScope,
  peopleInCalendarScope
} from '../utils/familyBranches'

test('branch preview keeps scopes independent and shows only the first generation without repeating its anchor', () => {
  const branch = {
    id: 'branch-a',
    anchor_person_id: 'inlaw',
    root_person_id: 'inlaw'
  } as FamilyBranch
  const people = [
    { id: 'inlaw', generation: 8 },
    { id: 'father', generation: null },
    { id: 'mother', generation: null },
    { id: 'hidden', generation: null }
  ] as Person[]
  const edges = [
    {
      id: 'father',
      type: 'biological_child',
      person_a: 'father',
      person_b: 'inlaw',
      family_branch_id: 'branch-a'
    },
    {
      id: 'mother',
      type: 'biological_child',
      person_a: 'mother',
      person_b: 'inlaw',
      family_branch_id: 'branch-a'
    },
    {
      id: 'couple-main',
      type: 'marriage',
      person_a: 'father',
      person_b: 'mother',
      family_branch_id: null
    },
    {
      id: 'couple-branch',
      type: 'marriage',
      person_a: 'mother',
      person_b: 'father',
      family_branch_id: 'branch-a'
    },
    {
      id: 'other-scope',
      type: 'biological_child',
      person_a: 'hidden',
      person_b: 'inlaw',
      family_branch_id: 'branch-b'
    }
  ] as Relationship[]
  const preview = branchTreePreview(branch, people, edges, [
    { branch_id: 'branch-a', person_id: 'inlaw', generation: 2 },
    { branch_id: 'branch-a', person_id: 'father', generation: 1 },
    { branch_id: 'branch-a', person_id: 'mother', generation: 1 }
  ])
  assert.deepEqual(preview.rootIds, ['father'])
  assert.equal(preview.persons.find((p) => p.id === 'inlaw')?.generation, 2)
  assert.equal(people[0].generation, 8)
  assert.equal(preview.relationships.length, 3)
  assert.equal(
    preview.relationships.filter((r) => r.type === 'marriage').length,
    1
  )
  assert.ok(!preview.persons.some((p) => p.id === 'hidden'))
  const configured = branchTreePreview(
    { ...branch, root_person_id: 'mother' },
    people,
    edges,
    [
      { branch_id: 'branch-a', person_id: 'inlaw', generation: 2 },
      { branch_id: 'branch-a', person_id: 'father', generation: 1 },
      { branch_id: 'branch-a', person_id: 'mother', generation: 1 }
    ]
  )
  assert.deepEqual(configured.rootIds, ['mother'])
  assert.deepEqual(
    branchFirstGeneration(preview).map((person) => person.id),
    ['father', 'mother']
  )
  const unnumbered = {
    ...preview,
    persons: preview.persons.map((person) => ({ ...person, generation: null }))
  }
  assert.deepEqual(
    branchFirstGeneration(unnumbered).map((person) => person.id),
    ['father', 'mother']
  )
  assert.deepEqual(
    branchFirstGeneration({
      ...preview,
      persons: preview.persons.filter((person) => person.id === 'inlaw'),
      rootIds: ['inlaw']
    }),
    []
  )
})

const persons = [
  { id: 'ancestor', family_branch_id: null },
  { id: 'inlaw', family_branch_id: null },
  { id: 'parent-inlaw', family_branch_id: 'branch-a' },
  { id: 'other-relative', family_branch_id: 'branch-b' }
]
const relationships = [
  { person_a: 'ancestor', person_b: 'inlaw', family_branch_id: null },
  { person_a: 'parent-inlaw', person_b: 'inlaw', family_branch_id: 'branch-a' },
  // Both profiles already exist in main: their auxiliary connection stays auxiliary.
  { person_a: 'inlaw', person_b: 'ancestor', family_branch_id: 'branch-a' },
  { person_a: 'other-relative', person_b: 'inlaw', family_branch_id: null }
]
const members = [
  { branch_id: 'branch-a', person_id: 'inlaw' },
  { branch_id: 'branch-a', person_id: 'parent-inlaw' },
  { branch_id: 'branch-b', person_id: 'inlaw' },
  { branch_id: 'branch-b', person_id: 'other-relative' }
]

test('main genealogy excludes auxiliary parents and auxiliary relations between shared profiles', () => {
  const scope = mainFamilyScope(persons, relationships)
  assert.deepEqual(
    scope.persons.map((person) => person.id),
    ['ancestor', 'inlaw']
  )
  assert.deepEqual(scope.relationships, [relationships[0]])
  // Old database rows have no scope field and remain main-family data.
  assert.equal(mainFamilyScope([{ id: 'legacy' }], []).persons.length, 1)
})

test('calendar scopes preserve shared people without duplicating their memorial dates', () => {
  assert.deepEqual(
    peopleInCalendarScope(persons, members, 'main').map((person) => person.id),
    ['ancestor', 'inlaw']
  )
  assert.deepEqual(
    peopleInCalendarScope(persons, members, 'branch-a').map(
      (person) => person.id
    ),
    ['inlaw', 'parent-inlaw']
  )
  assert.deepEqual(
    peopleInCalendarScope(persons, members, 'branch-b').map(
      (person) => person.id
    ),
    ['inlaw', 'other-relative']
  )
  assert.deepEqual(peopleInCalendarScope(persons, members, 'unknown'), [])
  const calendarPeople = persons.map((person) => ({
    ...person,
    full_name: person.id,
    is_deceased: true,
    birth_year: null,
    birth_month: null,
    birth_day: null,
    death_year: null,
    death_month: null,
    death_day: null,
    death_lunar_year: null,
    death_lunar_month: null,
    death_lunar_day: null,
    memorial_day: 15,
    memorial_month: 10,
    memorial_calendar: 'solar' as const
  }))
  const events = computeEvents(
    peopleInCalendarScope(calendarPeople, members, 'all')
  )
  const sharedEvents = events.filter((event) => event.personId === 'inlaw')
  // computeEvents includes past and next recurrences; each occurrence appears once.
  assert.ok(sharedEvents.length > 0)
  assert.equal(
    new Set(sharedEvents.map((event) => event.nextOccurrence.getTime())).size,
    sharedEvents.length
  )
})
