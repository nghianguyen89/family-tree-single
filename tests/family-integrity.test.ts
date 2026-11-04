import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

import { installAuthSessions } from './helpers/auth-sessions'

const db = new PGlite()
const uid = (n: number) =>
  `29000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [admin, editor, member, inactive] = [1, 2, 3, 4].map(uid)
const [parent, spouse, unrelated, anchor, anchorPartner] = [
  10, 11, 12, 13, 14
].map(uid)
let branch: string
let auxiliary: string
const migration = readFileSync(
  'docs/migrations/20261029000000_family_data_integrity.sql',
  'utf8'
)

async function as(user: string | null, sql: string, params: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`)
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
      user || ''
    ])
    return tx.query<Record<string, unknown>>(sql, params)
  })
}
const add = (
  children: unknown,
  other: string | null = spouse,
  user = editor,
  id = parent
) =>
  as(user, 'SELECT public.add_family_children($1,$2::jsonb,$3) AS ids', [
    id,
    JSON.stringify(children),
    other
  ])
const child = (name = 'Synthetic child') => ({
  full_name: name,
  gender: 'other',
  birth_year: 2024,
  birth_month: 2,
  birth_day: 29
})
const lineage = (id = parent, generation: unknown = 4) => ({
  id,
  generation,
  birth_order: null,
  is_in_law: false
})
const apply = (changes: unknown, user = admin) =>
  as(user, 'SELECT public.apply_lineage_updates($1::jsonb)', [
    JSON.stringify(changes)
  ])

before(async () => {
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth,storage TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
  `)
  await installAuthSessions(db)
  await db.exec(
    readFileSync('docs/schema.sql', 'utf8').replace(
      'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;',
      ''
    )
  )
  for (const file of readdirSync('docs/migrations')
    .filter((f) => f.endsWith('.sql'))
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
      `${id}@example.test`
    ])
    await db.query(
      'UPDATE public.profiles SET role=$1::public.user_role_enum,is_active=$2 WHERE id=$3',
      [role, active, id]
    )
  }
  for (const id of [parent, spouse, unrelated, anchor, anchorPartner]) {
    await db.query(
      "INSERT INTO public.persons(id,full_name,gender,generation,is_in_law) VALUES ($1,'Synthetic person','other',2,$2)",
      [id, id === anchor]
    )
  }
  await db.query(
    "INSERT INTO public.relationships(person_a,person_b,type) VALUES ($1,$2,'marriage')",
    [anchor, anchorPartner]
  )
  branch = String(
    (
      await as(admin, 'SELECT public.create_family_branch($1,$2) AS id', [
        anchor,
        'Synthetic branch'
      ])
    ).rows[0].id
  )
  auxiliary = String(
    (
      await as(
        admin,
        'SELECT public.add_family_branch_person($1,$2::jsonb) AS id',
        [branch, JSON.stringify(child('Synthetic auxiliary'))]
      )
    ).rows[0].id
  )
})
after(async () => db.close())

test('child RPC denies unauthorized callers and branch-owned or invalid parents', async () => {
  for (const user of [null, member, inactive]) {
    await assert.rejects(() =>
      as(user, 'SELECT public.add_family_children($1,$2::jsonb)', [
        parent,
        JSON.stringify([child()])
      ])
    )
  }
  await assert.rejects(
    () => add([child()], null, editor, uid(999)),
    /Invalid parent/
  )
  await assert.rejects(
    () => add([child()], null, admin, auxiliary),
    /Invalid parent/
  )
  await assert.rejects(() => add([child()], parent), /Invalid second parent/)
  await assert.rejects(
    () => add([child()], auxiliary, admin),
    /Invalid second parent/
  )
})

test('child RPC reads generation from database and creates every requested relationship', async () => {
  await db.query('UPDATE public.persons SET generation=5 WHERE id=$1', [parent])
  const ids = (
    await add([
      child(),
      {
        full_name: 'Partial date',
        gender: 'female',
        birth_month: 2,
        birth_day: 29
      }
    ])
  ).rows[0].ids as string[]
  assert.equal(ids.length, 2)
  const people = await db.query<{
    generation: number
    birth_year: number | null
    is_in_law: boolean
  }>(
    'SELECT generation,birth_year,is_in_law FROM public.persons WHERE id=ANY($1) ORDER BY birth_year NULLS LAST',
    [ids]
  )
  assert.deepEqual(people.rows, [
    { generation: 6, birth_year: 2024, is_in_law: false },
    { generation: 6, birth_year: null, is_in_law: false }
  ])
  const relationships = await db.query(
    'SELECT * FROM public.relationships WHERE person_b=ANY($1)',
    [ids]
  )
  assert.equal(relationships.rows.length, 4)
})

test('invalid second row and relationship failure roll back all children and edges', async () => {
  const count = async () =>
    (
      await db.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM public.persons'
      )
    ).rows[0].count
  const initial = await count()
  for (const invalid of [
    { ...child(), birth_year: 2023 },
    { ...child(), birth_month: 13 },
    { ...child(), birth_order: 0 },
    { ...child(), birth_day: '29' },
    { ...child(), generation: 99 },
    { ...child(), full_name: '' },
    { ...child(), gender: null }
  ]) {
    await assert.rejects(() => add([child('Earlier row'), invalid]))
    assert.equal(await count(), initial)
  }
  await db.exec(`CREATE FUNCTION public.fail_second_parent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.person_a='${spouse}'::uuid AND NEW.type='biological_child' THEN RAISE EXCEPTION 'synthetic relationship failure'; END IF;
    RETURN NEW; END; $$;
    CREATE TRIGGER test_fail_second_parent BEFORE INSERT ON public.relationships FOR EACH ROW EXECUTE FUNCTION public.fail_second_parent();`)
  try {
    await assert.rejects(
      () => add([child('Will roll back')]),
      /synthetic relationship failure/
    )
    assert.equal(await count(), initial)
  } finally {
    await db.exec(
      'DROP TRIGGER test_fail_second_parent ON public.relationships; DROP FUNCTION public.fail_second_parent()'
    )
  }
})

test('child RPC bounds batch arrays', async () => {
  await assert.rejects(() => add([]), /count/)
  await assert.rejects(() => add({}), /Invalid children/)
  await assert.rejects(
    () => add(Array.from({ length: 10001 }, () => child())),
    /count/
  )
})

test('direct ancestry insert and update reject main cycles across biological and adopted edges', async () => {
  await as(
    editor,
    "INSERT INTO public.relationships(person_a,person_b,type) VALUES ($1,$2,'biological_child'),($2,$3,'adopted_child')",
    [parent, spouse, unrelated]
  )
  await db.exec(`CREATE POLICY test_hidden_ancestry ON public.relationships AS RESTRICTIVE FOR SELECT TO authenticated
    USING (public.is_admin() OR person_a <> '${spouse}'::uuid);`)
  try {
    assert.equal(
      (
        await as(
          editor,
          'SELECT id FROM relationships WHERE person_a=$1 AND person_b=$2',
          [spouse, unrelated]
        )
      ).rows.length,
      0
    )
    await assert.rejects(
      () =>
        as(
          editor,
          "INSERT INTO public.relationships(person_a,person_b,type) VALUES ($1,$2,'adopted_child')",
          [unrelated, parent]
        ),
      /ancestry_cycle/
    )
  } finally {
    await db.exec('DROP POLICY test_hidden_ancestry ON public.relationships')
  }
  const marriage = await as(
    editor,
    "INSERT INTO public.relationships(person_a,person_b,type) VALUES ($1,$2,'marriage') RETURNING id",
    [unrelated, parent]
  )
  await assert.rejects(
    () =>
      as(
        editor,
        "UPDATE public.relationships SET type='biological_child' WHERE id=$1",
        [marriage.rows[0].id]
      ),
    /ancestry_cycle/
  )
  // Excluding the edge being updated allows reversal when no other return path exists.
  await as(
    editor,
    "UPDATE public.relationships SET person_a=$2,person_b=$3 WHERE type='adopted_child' AND person_a=$1",
    [spouse, unrelated, spouse]
  )
  await as(
    editor,
    'DELETE FROM public.relationships WHERE person_a IN ($1,$2,$3) AND person_b IN ($1,$2,$3)',
    [parent, spouse, unrelated]
  )
})

test('branch cycle checks see hidden edges while keeping main and branch scopes independent', async () => {
  await db.query(
    'INSERT INTO public.family_branch_members(branch_id,person_id) VALUES ($1,$2),($1,$3)',
    [branch, spouse, unrelated]
  )
  await as(
    admin,
    "INSERT INTO public.relationships(person_a,person_b,type,family_branch_id) VALUES ($1,$2,'biological_child',$3)",
    [spouse, unrelated, branch]
  )
  assert.equal(
    (
      await as(
        editor,
        'SELECT * FROM public.relationships WHERE family_branch_id=$1',
        [branch]
      )
    ).rows.length,
    0
  )
  await assert.rejects(
    () =>
      as(
        admin,
        "INSERT INTO public.relationships(person_a,person_b,type,family_branch_id) VALUES ($1,$2,'adopted_child',$3)",
        [unrelated, spouse, branch]
      ),
    /ancestry_cycle/
  )
  // Reversing an edge in a separate scope is valid.
  await as(
    editor,
    "INSERT INTO public.relationships(person_a,person_b,type) VALUES ($1,$2,'adopted_child')",
    [unrelated, spouse]
  )
  await as(
    editor,
    'DELETE FROM public.relationships WHERE person_a=$1 AND person_b=$2 AND family_branch_id IS NULL',
    [unrelated, spouse]
  )
})

test('lineage RPC is admin-only, validates every row and never accepts missing or auxiliary people', async () => {
  for (const user of [null, editor, member, inactive])
    await assert.rejects(() =>
      as(user, 'SELECT public.apply_lineage_updates($1::jsonb)', [
        JSON.stringify([lineage()])
      ])
    )
  const original = (
    await db.query<{ generation: number }>(
      'SELECT generation FROM persons WHERE id=$1',
      [parent]
    )
  ).rows[0].generation
  for (const invalid of [
    lineage(uid(999)),
    lineage(auxiliary),
    lineage(spouse, '3'),
    lineage(spouse, 0),
    { ...lineage(spouse), is_in_law: 'false' },
    { ...lineage(spouse), full_name: 'Unexpected' },
    { id: spouse }
  ]) {
    await assert.rejects(() => apply([lineage(), invalid]))
    assert.equal(
      (
        await db.query<{ generation: number }>(
          'SELECT generation FROM persons WHERE id=$1',
          [parent]
        )
      ).rows[0].generation,
      original
    )
  }
  await assert.rejects(() => apply([lineage(), lineage()]), /duplicate/)
  await apply([lineage(), lineage(spouse, null)])
  assert.deepEqual(
    (
      await db.query(
        'SELECT generation,birth_order,is_in_law FROM persons WHERE id=$1',
        [parent]
      )
    ).rows,
    [{ generation: 4, birth_order: null, is_in_law: false }]
  )
})

test('lineage and descendant RPCs roll back when a later target update fails', async () => {
  await as(
    editor,
    "INSERT INTO public.relationships(person_a,person_b,type) VALUES ($1,$2,'biological_child'),($1,$3,'adopted_child')",
    [parent, spouse, unrelated]
  )
  await db.query('UPDATE persons SET generation=5 WHERE id IN ($1,$2)', [
    spouse,
    unrelated
  ])
  await db.exec(`CREATE FUNCTION public.fail_generation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.id='${unrelated}'::uuid AND NEW.generation<>OLD.generation THEN RAISE EXCEPTION 'synthetic generation failure'; END IF;
    RETURN NEW; END; $$;
    CREATE TRIGGER test_fail_generation BEFORE UPDATE ON public.persons FOR EACH ROW EXECUTE FUNCTION public.fail_generation();`)
  try {
    await assert.rejects(
      () => apply([lineage(spouse, 7), lineage(unrelated, 7)]),
      /synthetic generation failure/
    )
    await assert.rejects(
      () =>
        as(editor, 'SELECT public.update_descendant_generations($1,2)', [
          parent
        ]),
      /synthetic generation failure/
    )
    assert.deepEqual(
      (
        await db.query('SELECT generation FROM persons WHERE id IN ($1,$2)', [
          spouse,
          unrelated
        ])
      ).rows,
      [{ generation: 5 }, { generation: 5 }]
    )
  } finally {
    await db.exec(
      'DROP TRIGGER test_fail_generation ON public.persons; DROP FUNCTION public.fail_generation()'
    )
  }
  await as(editor, 'SELECT public.update_descendant_generations($1,2)', [
    parent
  ])
  assert.deepEqual(
    (
      await db.query('SELECT generation FROM persons WHERE id IN ($1,$2)', [
        spouse,
        unrelated
      ])
    ).rows,
    [{ generation: 7 }, { generation: 7 }]
  )
})

test('descendant RPC keeps branch generations isolated and rejects inactive or viewing roles', async () => {
  for (const user of [null, member, inactive]) {
    await assert.rejects(() =>
      as(user, 'SELECT public.update_descendant_generations($1,1)', [parent])
    )
  }
  await assert.rejects(
    () =>
      as(admin, 'SELECT public.update_descendant_generations($1,1)', [
        auxiliary
      ]),
    /Invalid person/
  )
  await assert.rejects(
    () =>
      as(editor, 'SELECT public.update_descendant_generations($1,101)', [
        parent
      ]),
    /Invalid generation delta/
  )
  await db.query(
    'INSERT INTO public.family_branch_members(branch_id,person_id) VALUES ($1,$2)',
    [branch, parent]
  )
  await as(
    admin,
    "INSERT INTO public.relationships(person_a,person_b,type,family_branch_id) VALUES ($1,$2,'adopted_child',$3)",
    [parent, anchor, branch]
  )
  const before = (
    await db.query('SELECT generation FROM persons WHERE id=$1', [anchor])
  ).rows
  await as(editor, 'SELECT public.update_descendant_generations($1,1)', [
    parent
  ])
  assert.deepEqual(
    (await db.query('SELECT generation FROM persons WHERE id=$1', [anchor]))
      .rows,
    before
  )
  assert.equal(
    (
      await db.query<{ generation: number | null }>(
        'SELECT generation FROM persons WHERE id=$1',
        [auxiliary]
      )
    ).rows[0].generation,
    null
  )
})

test('cyclic backup import leaves the complete existing family intact', async () => {
  const before = await db.query('SELECT id FROM persons ORDER BY id')
  const a = uid(100)
  const b = uid(101)
  await assert.rejects(
    () =>
      as(admin, 'SELECT public.import_family_backup($1::jsonb)', [
        JSON.stringify({
          persons: [
            {
              id: a,
              full_name: 'A',
              gender: 'male',
              is_deceased: false,
              is_in_law: false
            },
            {
              id: b,
              full_name: 'B',
              gender: 'female',
              is_deceased: false,
              is_in_law: false
            }
          ],
          relationships: [
            { person_a: a, person_b: b, type: 'biological_child' },
            { person_a: b, person_b: a, type: 'adopted_child' }
          ],
          person_details_private: [],
          custom_events: []
        })
      ]),
    /ancestry_cycle/
  )
  assert.deepEqual(
    (await db.query('SELECT id FROM persons ORDER BY id')).rows,
    before.rows
  )
})
