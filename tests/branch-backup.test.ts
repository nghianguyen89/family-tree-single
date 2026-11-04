import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import ts from 'typescript'

import { validateImportPayload } from '../utils/backup-validation'
import { exportToGedcom } from '../utils/gedcom'

const ids = {
  anchor: '11111111-1111-4111-8111-111111111111',
  root: '22222222-2222-4222-8222-222222222222',
  shared: '33333333-3333-4333-8333-333333333333',
  branch: '44444444-4444-4444-8444-444444444444'
}
const t = (key: string) => key

function backup() {
  return {
    persons: [
      { id: ids.anchor, full_name: 'Anchor', gender: 'male' },
      {
        id: ids.root,
        full_name: 'Branch root',
        gender: 'female',
        family_branch_id: ids.branch as string | null
      },
      { id: ids.shared, full_name: 'Shared', gender: 'male' }
    ],
    relationships: [
      {
        type: 'biological_child',
        person_a: ids.anchor,
        person_b: ids.root,
        family_branch_id: ids.branch as string | null
      }
    ],
    family_branches: [
      {
        id: ids.branch,
        name: 'A branch',
        anchor_person_id: ids.anchor,
        partner_person_id: null as string | null,
        root_person_id: ids.root
      }
    ],
    family_branch_members: [
      { branch_id: ids.branch, person_id: ids.anchor, generation: 1 },
      { branch_id: ids.branch, person_id: ids.root, generation: 2 },
      { branch_id: ids.branch, person_id: ids.shared, generation: null }
    ]
  }
}

test('branch backup validates shared profiles, ownership, and branch relationships', () => {
  assert.equal(validateImportPayload(backup(), t), null)
  const legacyBranchBackup = backup()
  Reflect.deleteProperty(
    legacyBranchBackup.family_branches[0],
    'partner_person_id'
  )
  assert.equal(validateImportPayload(legacyBranchBackup, t), null)
  const old = {
    persons: [{ id: ids.anchor, full_name: 'Anchor', gender: 'male' }],
    relationships: []
  }
  assert.equal(validateImportPayload(old, t), null)
})

test('branch backup rejects missing references and duplicate memberships', () => {
  const missingBranch = backup()
  missingBranch.family_branches = []
  assert.notEqual(validateImportPayload(missingBranch, t), null)

  const missingAnchor = backup()
  missingAnchor.family_branch_members.shift()
  assert.notEqual(validateImportPayload(missingAnchor, t), null)

  const duplicateMember = backup()
  duplicateMember.family_branch_members.push(
    duplicateMember.family_branch_members[0]
  )
  assert.notEqual(validateImportPayload(duplicateMember, t), null)

  const danglingRelation = backup()
  danglingRelation.relationships[0].family_branch_id = ids.shared
  assert.notEqual(validateImportPayload(danglingRelation, t), null)

  const missingEndpoint = backup()
  missingEndpoint.family_branch_members.pop()
  missingEndpoint.relationships[0].person_b = ids.shared
  assert.notEqual(validateImportPayload(missingEndpoint, t), null)
})

test('identical relationships may exist in main and an auxiliary branch only once per scope', () => {
  const scoped = backup()
  scoped.relationships.push({
    type: 'biological_child',
    person_a: ids.anchor,
    person_b: ids.root,
    family_branch_id: null
  })
  assert.equal(validateImportPayload(scoped, t), null)
  scoped.relationships.push({ ...scoped.relationships[0] })
  assert.notEqual(validateImportPayload(scoped, t), null)
})

test('GEDCOM export refuses to discard branch ownership', () => {
  assert.throws(() => exportToGedcom(backup()), /JSON backup/)
})

test('branch partner requires an exported main person and a main marriage in either direction', () => {
  const payload = backup()
  payload.family_branches[0].partner_person_id = ids.shared
  assert.notEqual(validateImportPayload(payload, t), null)
  payload.relationships.push({
    type: 'marriage',
    person_a: ids.shared,
    person_b: ids.anchor,
    family_branch_id: null
  })
  assert.equal(validateImportPayload(payload, t), null)

  for (const invalid of ['invalid', ids.branch, ids.anchor, ids.root]) {
    payload.family_branches[0].partner_person_id = invalid
    assert.notEqual(validateImportPayload(payload, t), null)
  }
  payload.family_branches[0].partner_person_id = ids.shared
  payload.relationships[1].family_branch_id = ids.branch
  assert.notEqual(validateImportPayload(payload, t), null)
})

// Load server actions with local dependencies so these tests cannot change the
// module mocks used by unrelated route tests in the same Bun process.
function dataActions(rows: Record<string, unknown[]>) {
  const captured: { payload?: Record<string, unknown> } = {}
  const db = {
    from(table: string) {
      const query = {
        select: () => query,
        order: () => query,
        range: async (from: number, to: number) => ({
          data: (rows[table] ?? []).slice(from, to + 1),
          error: null
        })
      }
      return query
    },
    rpc: async (
      _name: string,
      params: { payload: Record<string, unknown> }
    ) => {
      captured.payload = params.payload
      return { error: null }
    }
  }
  const dependencies: Record<string, unknown> = {
    'next/cache': { revalidatePath() {} },
    '@/lib/i18n/server': { getServerTranslations: async () => ({ t }) },
    '@/utils/backup-validation': { validateImportPayload },
    '@/utils/supabase/queries': {
      getIsAdmin: async () => true,
      getSupabase: async () => db
    },
    '@/utils/supabase/fetchAll': {
      fetchAllRows: async (
        fetchPage: (from: number, to: number) => Promise<unknown>
      ) => fetchPage(0, 999)
    }
  }
  const compiled = ts.transpileModule(
    readFileSync(new URL('../app/actions/data.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText
  const exports = {} as {
    exportData: (rootId: string) => Promise<ReturnType<typeof backup>>
    importData: (payload: ReturnType<typeof backup>) => Promise<unknown>
  }
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`)
      return dependencies[name]
    }
  })
  return { ...exports, captured }
}

test('scoped backup closes over partner marriage and ownership without exporting account mappings', async () => {
  const payload = backup()
  payload.family_branches[0].partner_person_id = ids.shared
  // Selecting a branch-owned person exercises ownership closure: neither the
  // anchor nor the chosen main spouse starts in the descendant traversal.
  payload.family_branch_members.pop()
  payload.relationships.push({
    type: 'marriage',
    person_a: ids.anchor,
    person_b: ids.shared,
    family_branch_id: null
  })
  const actions = dataActions({
    persons: payload.persons,
    relationships: payload.relationships,
    family_branches: payload.family_branches,
    family_branch_members: payload.family_branch_members,
    profiles: [{ person_id: ids.anchor, id: 'private-account-id' }]
  })
  const exported = await actions.exportData(ids.root)
  assert.deepEqual(
    new Set(exported.persons.map((p) => p.id)),
    new Set([ids.anchor, ids.root, ids.shared])
  )
  assert.equal(exported.relationships.length, 2)
  assert.equal(exported.family_branches[0].partner_person_id, ids.shared)
  assert.equal(validateImportPayload(exported, t), null)
  assert.equal('profiles' in exported, false)
  assert.equal(JSON.stringify(exported).includes('private-account-id'), false)

  await actions.importData(exported)
  const imported = actions.captured.payload!
  assert.equal(
    (imported.family_branches as typeof payload.family_branches)[0]
      .partner_person_id,
    ids.shared
  )
  assert.equal('profiles' in imported, false)
})
