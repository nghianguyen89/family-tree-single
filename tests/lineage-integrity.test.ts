import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import ts from 'typescript'

import type { Person, Relationship } from '../types'
import { validateImportPayload } from '../utils/backup-validation'
import { computeGenerations, hasAncestryCycle } from '../utils/lineage'

const person = (id: string) =>
  ({ id, full_name: id, gender: 'other' }) as Person
const edge = (
  a: string,
  b: string,
  type = 'biological_child',
  scope: string | null = null
) =>
  ({ person_a: a, person_b: b, type, family_branch_id: scope }) as Relationship

test('ancestry validator rejects disconnected, adopted and deep cycles within each scope', () => {
  assert.equal(
    hasAncestryCycle([
      edge('a', 'b'),
      edge('b', 'c', 'adopted_child'),
      edge('c', 'a')
    ]),
    true
  )
  assert.equal(
    hasAncestryCycle([
      edge('a', 'b'),
      edge('b', 'a', 'adopted_child', 'branch')
    ]),
    false
  )
  assert.equal(
    hasAncestryCycle([edge('a', 'b', 'marriage'), edge('b', 'a', 'marriage')]),
    false
  )
  const deep = Array.from({ length: 10000 }, (_, i) =>
    edge(String(i), String(i + 1))
  )
  assert.equal(hasAncestryCycle(deep), false)
  deep.push(edge('10000', '0', 'adopted_child'))
  assert.equal(hasAncestryCycle(deep), true)
  assert.throws(
    () =>
      computeGenerations(['root', 'a', 'b'].map(person), [
        edge('a', 'b'),
        edge('b', 'a')
      ]),
    /ancestry_cycle/
  )
})

test('calculator rejects spouse positive cycles even when no root can reach them', () => {
  assert.throws(
    () =>
      computeGenerations(['a', 'b'].map(person), [
        edge('a', 'b'),
        edge('a', 'b', 'marriage')
      ]),
    /ancestry_cycle/
  )
  assert.throws(
    () =>
      computeGenerations(['root', 'a', 'b', 'c', 'd'].map(person), [
        edge('a', 'b', 'marriage'),
        edge('c', 'd', 'marriage'),
        edge('a', 'c'),
        edge('d', 'b')
      ]),
    /ancestry_cycle/
  )
  const result = computeGenerations(
    ['root', 'child', 'spouse', 'grandchild'].map(person),
    [
      edge('root', 'child'),
      edge('child', 'spouse', 'marriage'),
      edge('spouse', 'grandchild', 'adopted_child')
    ]
  )
  assert.deepEqual([...result].sort(), [
    ['child', 2],
    ['grandchild', 3],
    ['root', 1],
    ['spouse', 2]
  ])
})

test('backup rejects cyclic ancestry before any write and preserves scope separation', () => {
  const a = '29000000-0000-4000-8000-000000000001'
  const b = '29000000-0000-4000-8000-000000000002'
  const branch = '29000000-0000-4000-8000-000000000003'
  const payload = {
    persons: [person(a), person(b)],
    relationships: [edge(a, b), edge(b, a, 'adopted_child')],
    family_branches: [
      { id: branch, name: 'Synthetic branch', anchor_person_id: a }
    ],
    family_branch_members: [
      { branch_id: branch, person_id: a },
      { branch_id: branch, person_id: b }
    ]
  }
  assert.equal(
    validateImportPayload(payload, (key) => key),
    'lineageCycleError'
  )
  payload.relationships[1].family_branch_id = branch
  assert.equal(
    validateImportPayload(payload, (key) => key),
    null
  )
  payload.relationships.push(edge(a, b, 'biological_child', branch))
  assert.equal(
    validateImportPayload(payload, (key) => key),
    'lineageCycleError'
  )
})

// Execute the component's real handler with simulated network/state boundaries.
function handler(file: string, name: string, context: Record<string, unknown>) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  let code: string | undefined
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === name &&
      node.initializer
    )
      code = node.initializer.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(code, `Handler ${name} exists`)
  return runInNewContext(
    ts.transpileModule(`(${code})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText,
    context
  ) as () => unknown
}

test('bulk handler keeps entered rows and the dialog open when the single atomic RPC fails', async () => {
  let calls = 0
  let shownError = ''
  let closed = false
  let reset = false
  let refreshed = false
  let processing = false
  const save = handler('components/RelationshipManager.tsx', 'handleBulkAdd', {
    bulkChildren: [
      {
        name: 'Synthetic child',
        gender: 'other',
        birthYear: '2024',
        birthMonth: '2',
        birthDay: '29',
        birthOrder: '1'
      }
    ],
    isValidQuickBirthDate: () => true,
    personId: 'parent',
    selectedSpouseId: 'spouse',
    supabase: {
      rpc: async (
        name: string,
        args: { parent_id: string; children: unknown[] }
      ) => {
        calls++
        assert.equal(name, 'add_family_children')
        assert.equal(args.parent_id, 'parent')
        assert.equal(args.children.length, 1)
        return { error: { message: 'relationship denied' } }
      }
    },
    t: (key: string, values?: { error?: string }) => values?.error || key,
    setProcessing: (value: boolean) => {
      processing = value
    },
    setError: (value: string) => {
      shownError = value
    },
    setIsAddingBulk: () => {
      closed = true
    },
    setBulkChildren: () => {
      reset = true
    },
    setSelectedSpouseId: () => {
      reset = true
    },
    fetchRelationships: () => {
      refreshed = true
    },
    router: {
      refresh: () => {
        refreshed = true
      }
    },
    setTimeout: () => 0
  })
  await save()
  assert.equal(calls, 1)
  assert.equal(shownError, 'relationship denied')
  assert.equal(closed, false)
  assert.equal(reset, false)
  assert.equal(refreshed, false)
  assert.equal(processing, false)
})

test('failed lineage apply shows the RPC error without declaring success', async () => {
  let success = false
  let error = ''
  const apply = handler('components/LineageManager.tsx', 'handleApply', {
    updates: [
      {
        id: 'a',
        changed: true,
        new_generation: 2,
        new_birth_order: 1,
        new_is_in_law: false
      }
    ],
    supabase: {
      rpc: async () => ({ error: { message: 'lineage transaction failed' } })
    },
    setApplying() {},
    setError: (message: string) => {
      error = message
    },
    setApplied: () => {
      success = true
    },
    t: (key: string) => key
  })
  await apply()
  assert.equal(success, false)
  assert.equal(error, 'lineage transaction failed')
})

test('failed calculation clears stale preview and translates the cycle error', () => {
  let updates: unknown = ['old preview']
  let error = ''
  const compute = handler('components/LineageManager.tsx', 'handleCompute', {
    persons: [],
    relationships: [],
    computeGenerations: () => {
      throw new Error('ancestry_cycle')
    },
    setComputing() {},
    setApplied() {},
    setUpdates: (value: unknown) => {
      updates = value
    },
    setError: (value: string) => {
      error = value
    },
    t: (key: string) => `translated:${key}`
  })
  compute()
  assert.equal(updates, null)
  assert.equal(error, 'translated:lineageCycleError')
})
