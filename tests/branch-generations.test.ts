import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Person, Relationship } from '../types'
import type { FamilyBranch, FamilyBranchMember } from '../types/branches'
import {
  branchFirstGeneration,
  branchTreePreview
} from '../utils/familyBranches'

const branch = {
  id: 'a',
  anchor_person_id: 'daughter',
  root_person_id: 'father'
} as FamilyBranch
const people = ['father', 'mother', 'son', 'daughter'].map((id) => ({
  id,
  generation: 8
})) as Person[]
const edge = (
  a: string,
  b: string,
  type = 'biological_child',
  scope: string | null = 'a'
) =>
  ({
    id: `${a}-${b}-${type}`,
    person_a: a,
    person_b: b,
    type,
    family_branch_id: scope
  }) as Relationship
const edges = [
  edge('father', 'daughter'),
  edge('father', 'son'),
  edge('mother', 'son'),
  edge('father', 'mother', 'marriage'),
  edge('mother', 'daughter')
]
const members = people.map((p) => ({
  branch_id: 'a',
  person_id: p.id,
  generation: p.id === 'daughter' ? 2 : null
})) as FamilyBranchMember[]
const generations = (result: ReturnType<typeof branchTreePreview>) =>
  Object.fromEntries(result.persons.map((p) => [p.id, p.generation]))

test('branch list places an unnumbered elder sibling beside generation two and parents in generation one', () => {
  const result = branchTreePreview(branch, people, edges, members)
  assert.deepEqual(generations(result), {
    father: 1,
    mother: 1,
    son: 2,
    daughter: 2
  })
  assert.deepEqual(
    branchFirstGeneration(result).map((p) => p.id),
    ['father', 'mother']
  )
  assert.deepEqual(
    generations(
      branchTreePreview(
        branch,
        people,
        [...edges].reverse(),
        [...members].reverse()
      )
    ),
    generations(result)
  )
  assert.equal(people[0].generation, 8)
  assert.equal(members[0].generation, null)
})

test('adopted descendants and spouses inherit branch display generations over multiple levels', () => {
  const persons = [...people, { id: 'child' }, { id: 'spouse' }] as Person[]
  const result = branchTreePreview(
    branch,
    persons,
    [
      ...edges,
      edge('son', 'child', 'adopted_child'),
      edge('child', 'spouse', 'marriage')
    ],
    [
      ...members,
      { branch_id: 'a', person_id: 'child', generation: null },
      { branch_id: 'a', person_id: 'spouse', generation: null }
    ]
  )
  assert.equal(generations(result).child, 3)
  assert.equal(generations(result).spouse, 3)
})

test('unknown components and foreign-branch relations cannot borrow main or another branch generation', () => {
  const result = branchTreePreview(
    branch,
    [...people, { id: 'stranger', generation: 10 }] as Person[],
    [...edges, edge('daughter', 'stranger', 'biological_child', 'b')],
    [...members, { branch_id: 'a', person_id: 'stranger', generation: null }]
  )
  assert.equal(generations(result).stranger, null)
  assert.deepEqual(
    generations(
      branchTreePreview(
        branch,
        people,
        edges,
        members.map((m) => ({ ...m, generation: null }))
      )
    ),
    { father: null, mother: null, son: null, daughter: null }
  )
})

test('conflicting explicit generations or contradictory cycles stay unresolved without overwriting entries', () => {
  const conflicting = members.map((m) => ({
    ...m,
    generation: m.person_id === 'son' ? 3 : m.generation
  }))
  assert.deepEqual(
    generations(branchTreePreview(branch, people, edges, conflicting)),
    { father: null, mother: null, son: 3, daughter: 2 }
  )
  assert.equal(
    generations(
      branchTreePreview(
        branch,
        people,
        [...edges, edge('son', 'father')],
        members
      )
    ).son,
    null
  )
})

test('inference never creates generation zero and works with only main-scope relations among branch members', () => {
  const result = branchTreePreview(
    branch,
    people,
    edges.map((e) => ({ ...e, family_branch_id: null })),
    members.map((m) => ({
      ...m,
      generation: m.person_id === 'daughter' ? 1 : null
    }))
  )
  assert.deepEqual(generations(result), {
    father: null,
    mother: null,
    son: 1,
    daughter: 1
  })
})
