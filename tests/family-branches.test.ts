import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const admin = '11111111-1111-4111-8111-111111111111'
const editor = '22222222-2222-4222-8222-222222222222'
const member = '33333333-3333-4333-8333-333333333333'
const inactive = '44444444-4444-4444-8444-444444444444'
const anchor = '55555555-5555-4555-8555-555555555555'
const shared = '66666666-6666-4666-8666-666666666666'
const unrelated = '77777777-7777-4777-8777-777777777777'
const migration = readFileSync(
  'docs/migrations/20261019000000_family_branches.sql',
  'utf8'
)
let branch = ''
let child = ''
let secondBranch = ''

async function asRole<T extends Record<string, unknown>>(
  role: 'anon' | 'authenticated',
  user: string | null,
  sql: string,
  params: unknown[] = []
) {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${role}`)
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
      user ?? ''
    ])
    return tx.query<T>(sql, params)
  })
}

const add = (
  branchId: string,
  payload: unknown,
  relative: string | null = null,
  relation = 'member',
  existing: string | null = null,
  user = editor
) =>
  asRole<{ id: string }>(
    'authenticated',
    user,
    'SELECT public.add_family_branch_person($1,$2::jsonb,$3,$4,$5) AS id',
    [branchId, JSON.stringify(payload), relative, relation, existing]
  )

before(async () => {
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY, bucket_id text, name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
  `)
  await db.exec(
    readFileSync('docs/schema.sql', 'utf8').replace(
      'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;',
      ''
    )
  )
  for (const file of readdirSync('docs/migrations')
    // Base branch mechanics before the later privacy migration. Final access
    // rules and complete-bundle replay are covered by family-branch-privacy.
    .filter(
      (f) => f.endsWith('.sql') && f <= '20261019000000_family_branches.sql'
    )
    .sort()) {
    await db.exec(readFileSync(`docs/migrations/${file}`, 'utf8'))
  }
  await db.exec(migration)
  for (const [id, role, active] of [
    [admin, 'admin', true],
    [editor, 'editor', true],
    [member, 'member', true],
    [inactive, 'editor', false]
  ] as const) {
    await db.query('INSERT INTO auth.users VALUES ($1,$2,now())', [
      id,
      `${role}-${id}@example.com`
    ])
    await db.query(
      'UPDATE public.profiles SET role=$1::public.user_role_enum,is_active=$2 WHERE id=$3',
      [role, active, id]
    )
  }
  await db.query(
    `INSERT INTO public.persons(id,full_name,gender,is_in_law,generation)
    VALUES ($1,'Spouse','female',true,NULL),($2,'Shared parent','male',false,2),
      ($3,'Unrelated','female',false,3)`,
    [anchor, shared, unrelated]
  )
})
after(async () => db.close())

test('roles and branch creation enforce active editor and in-law anchor', async () => {
  const call = (user: string) =>
    asRole<{ id: string }>(
      'authenticated',
      user,
      'SELECT public.create_family_branch($1,$2) AS id',
      [anchor, 'Maternal ancestors']
    )
  await assert.rejects(() =>
    asRole('anon', null, 'SELECT public.create_family_branch($1,$2)', [
      anchor,
      'No'
    ])
  )
  await assert.rejects(() => call(member))
  await assert.rejects(() => call(inactive))
  await assert.rejects(() =>
    asRole(
      'authenticated',
      editor,
      'SELECT public.create_family_branch($1,$2)',
      [shared, 'Wrong anchor']
    )
  )
  branch = (await call(editor)).rows[0].id
  const rows = await db.query<{ person_id: string; root_person_id: string }>(
    `SELECT m.person_id,b.root_person_id FROM family_branch_members m
     JOIN family_branches b ON b.id=m.branch_id WHERE b.id=$1`,
    [branch]
  )
  assert.deepEqual(rows.rows, [{ person_id: anchor, root_person_id: anchor }])
  assert.equal(
    (
      await asRole(
        'authenticated',
        member,
        'SELECT id FROM family_branches WHERE id=$1',
        [branch]
      )
    ).rows.length,
    1
  )
  assert.equal(
    (
      await asRole(
        'authenticated',
        inactive,
        'SELECT id FROM family_branches WHERE id=$1',
        [branch]
      )
    ).rows.length,
    0
  )
  assert.equal(
    (
      await asRole('anon', null, 'SELECT id FROM family_branches WHERE id=$1', [
        branch
      ]).catch(() => ({ rows: [] }))
    ).rows.length,
    0
  )
})

test('new auxiliary person is owned and auto-enrolled; shared profile stays intact', async () => {
  child = (
    await add(
      branch,
      {
        full_name: 'Branch child',
        gender: 'male',
        birth_year_from: 1890,
        birth_year_to: 1895
      },
      anchor,
      'child'
    )
  ).rows[0].id
  const p = await db.query<{
    family_branch_id: string
    generation: number | null
    is_in_law: boolean
  }>('SELECT family_branch_id,generation,is_in_law FROM persons WHERE id=$1', [
    child
  ])
  assert.deepEqual(p.rows[0], {
    family_branch_id: branch,
    generation: null,
    is_in_law: false
  })
  assert.equal(
    (
      await db.query(
        'SELECT 1 FROM family_branch_members WHERE branch_id=$1 AND person_id=$2',
        [branch, child]
      )
    ).rows.length,
    1
  )
  assert.equal(
    (
      await db.query<{ family_branch_id: string }>(
        'SELECT family_branch_id FROM relationships WHERE person_a=$1 AND person_b=$2',
        [anchor, child]
      )
    ).rows[0].family_branch_id,
    branch
  )

  await add(
    branch,
    { full_name: 'Ignored', gender: 'female' },
    child,
    'parent',
    shared
  )
  const existing = await db.query<{
    generation: number
    is_in_law: boolean
    full_name: string
  }>('SELECT generation,is_in_law,full_name FROM persons WHERE id=$1', [shared])
  assert.deepEqual(existing.rows[0], {
    generation: 2,
    is_in_law: false,
    full_name: 'Shared parent'
  })
  await assert.rejects(() =>
    add(branch, { full_name: 'Bad', gender: 'male', generation: 3 })
  )
  await assert.rejects(() =>
    add(branch, { full_name: 'Bad', gender: 'male', is_in_law: true })
  )
  await assert.rejects(() =>
    add(branch, { full_name: 'No', gender: 'male' }, null, 'child')
  )
  await assert.rejects(() =>
    add(
      branch,
      { full_name: 'No', gender: 'male' },
      anchor,
      'child',
      null,
      member
    )
  )
})

test('cycle and duplicate spouse reject atomically; branch root and membership are guarded', async () => {
  const beforeCount = (
    await db.query<{ count: string }>('SELECT count(*) FROM persons')
  ).rows[0].count
  await assert.rejects(() => add(branch, {}, child, 'child', anchor), /cycle/i)
  await assert.rejects(() => add(branch, {}, child, 'spouse', child))
  assert.equal(
    (await db.query<{ count: string }>('SELECT count(*) FROM persons')).rows[0]
      .count,
    beforeCount
  )
  await add(branch, {}, child, 'spouse', shared)
  await assert.rejects(
    () => add(branch, {}, child, 'spouse', shared),
    /already exists/i
  )
  await assert.rejects(() =>
    asRole(
      'authenticated',
      editor,
      'DELETE FROM family_branch_members WHERE branch_id=$1 AND person_id=$2',
      [branch, anchor]
    )
  )
  await assert.rejects(() =>
    asRole(
      'authenticated',
      editor,
      'DELETE FROM family_branch_members WHERE branch_id=$1 AND person_id=$2',
      [branch, child]
    )
  )
  await assert.rejects(() =>
    asRole(
      'authenticated',
      editor,
      'UPDATE family_branches SET root_person_id=$2 WHERE id=$1',
      [branch, admin]
    )
  )
  await asRole(
    'authenticated',
    editor,
    'UPDATE family_branches SET root_person_id=$2 WHERE id=$1',
    [branch, shared]
  )
  await assert.rejects(() =>
    asRole(
      'authenticated',
      editor,
      'DELETE FROM family_branch_members WHERE branch_id=$1 AND person_id=$2',
      [branch, shared]
    )
  )
  await asRole(
    'authenticated',
    editor,
    'UPDATE family_branches SET root_person_id=$2 WHERE id=$1',
    [branch, anchor]
  )
  await assert.rejects(
    () =>
      asRole(
        'authenticated',
        editor,
        'DELETE FROM family_branch_members WHERE branch_id=$1 AND person_id=$2',
        [branch, shared]
      ),
    /relationships/i
  )
  await assert.rejects(
    () =>
      asRole(
        'authenticated',
        editor,
        'UPDATE family_branch_members SET person_id=$3 WHERE branch_id=$1 AND person_id=$2',
        [branch, shared, unrelated]
      ),
    /relationships/i
  )
  await add(branch, {}, null, 'member', unrelated)
  await asRole(
    'authenticated',
    editor,
    'DELETE FROM family_branch_members WHERE branch_id=$1 AND person_id=$2',
    [branch, unrelated]
  )
  await asRole(
    'authenticated',
    editor,
    'UPDATE family_branches SET root_person_id=$2 WHERE id=$1',
    [branch, shared]
  )
  await assert.rejects(() =>
    asRole(
      'authenticated',
      editor,
      'UPDATE persons SET family_branch_id=NULL WHERE id=$1',
      [child]
    )
  )
  await assert.rejects(
    () =>
      asRole(
        'authenticated',
        editor,
        'UPDATE persons SET is_in_law=false WHERE id=$1',
        [anchor]
      ),
    /anchor/i
  )
})

test('one owned profile may join another branch with a separate scoped edge', async () => {
  secondBranch = (
    await asRole<{ id: string }>(
      'authenticated',
      admin,
      'SELECT public.create_family_branch($1,$2) AS id',
      [anchor, 'Second branch']
    )
  ).rows[0].id
  await add(secondBranch, {}, anchor, 'child', child)
  const edges = await db.query<{ family_branch_id: string }>(
    `SELECT family_branch_id FROM relationships WHERE person_a=$1 AND person_b=$2
     ORDER BY family_branch_id`,
    [anchor, child]
  )
  assert.deepEqual(
    edges.rows.map((row) => row.family_branch_id).sort(),
    [branch, secondBranch].sort()
  )
  assert.equal(
    (
      await db.query(
        'SELECT 1 FROM family_branch_members WHERE branch_id=$1 AND person_id=$2',
        [secondBranch, child]
      )
    ).rows.length,
    1
  )
  await assert.rejects(() =>
    asRole(
      'authenticated',
      editor,
      `INSERT INTO relationships(type,person_a,person_b,family_branch_id)
     VALUES ('biological_child',$1,$2,NULL)`,
      [anchor, child]
    )
  )
})

test('public intake sees only main lineage and cannot choose an auxiliary root', async () => {
  const token = 'a'.repeat(64)
  await asRole(
    'authenticated',
    editor,
    `INSERT INTO family_intake_links(token_hash,title,root_person_id,expires_at)
     VALUES (md5($1),'Main intake',$2,now()+interval '1 day')`,
    [token, anchor]
  )
  const options = await asRole<{ value: { people: { id: string }[] } }>(
    'anon',
    null,
    'SELECT public.get_family_intake_options($1) AS value',
    [token]
  )
  assert.deepEqual(
    options.rows[0].value.people.map((p) => p.id),
    [anchor]
  )
  await assert.rejects(() =>
    asRole(
      'authenticated',
      editor,
      `INSERT INTO family_intake_links(token_hash,title,root_person_id,expires_at)
     VALUES (md5($1),'Auxiliary intake',$2,now()+interval '1 day')`,
      ['b'.repeat(64), child]
    )
  )
  const review = await db.query<{ definition: string }>(
    "SELECT pg_get_functiondef('public.review_family_intake(uuid,text,jsonb,text)'::regprocedure) AS definition"
  )
  assert.match(
    review.rows[0].definition,
    /WHERE r\.type IN \('biological_child','adopted_child'\) AND r\.family_branch_id IS NULL/
  )
})

test('full backup restores branches; legacy backup clears them and remains valid', async () => {
  const tables = [
    'persons',
    'relationships',
    'person_details_private',
    'custom_events',
    'family_branches',
    'family_branch_members'
  ] as const
  const payload: Record<string, unknown> = {}
  for (const table of tables)
    payload[table] = (await db.query(`SELECT * FROM public.${table}`)).rows
  await asRole(
    'authenticated',
    admin,
    'SELECT public.import_family_backup($1::jsonb)',
    [JSON.stringify(payload)]
  )
  assert.equal(
    (await db.query('SELECT 1 FROM family_branches WHERE id=$1', [branch])).rows
      .length,
    1
  )
  assert.equal(
    (
      await db.query<{ root_person_id: string }>(
        'SELECT root_person_id FROM family_branches WHERE id=$1',
        [branch]
      )
    ).rows[0].root_person_id,
    shared
  )
  assert.equal(
    (
      await db.query('SELECT 1 FROM family_branches WHERE id=$1', [
        secondBranch
      ])
    ).rows.length,
    1
  )
  assert.equal(
    (
      await db.query(
        'SELECT 1 FROM family_branch_members WHERE branch_id=$1 AND person_id=$2',
        [branch, child]
      )
    ).rows.length,
    1
  )
  assert.equal(
    (
      await db.query('SELECT 1 FROM relationships WHERE family_branch_id=$1', [
        branch
      ])
    ).rows.length,
    3
  )

  const legacy = { ...payload }
  delete legacy.family_branches
  delete legacy.family_branch_members
  legacy.persons = (payload.persons as Record<string, unknown>[])
    .filter((p) => p.family_branch_id === null)
    .map((p) => {
      const person = { ...p }
      delete person.family_branch_id
      return person
    })
  legacy.relationships = (payload.relationships as Record<string, unknown>[])
    .filter((r) => r.family_branch_id === null)
    .map((r) => {
      const relationship = { ...r }
      delete relationship.family_branch_id
      return relationship
    })
  await asRole(
    'authenticated',
    admin,
    'SELECT public.import_family_backup($1::jsonb)',
    [JSON.stringify(legacy)]
  )
  assert.equal((await db.query('SELECT 1 FROM family_branches')).rows.length, 0)
  assert.equal(
    (await db.query('SELECT 1 FROM persons WHERE id=$1', [anchor])).rows.length,
    1
  )
})
