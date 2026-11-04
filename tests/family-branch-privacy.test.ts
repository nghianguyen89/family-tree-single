import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

import { installAuthSessions } from './helpers/auth-sessions'

const db = new PGlite()
const uid = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [admin, wife, husband, outsider, reader, pending] = [
  1, 2, 3, 4, 5, 6
].map(uid)
const [anchor, partner, other, otherAnchor, otherPartner, secondSpouse] = [
  10, 11, 12, 13, 14, 15
].map(uid)
let branch = ''
let hiddenBranch = ''
let child = ''
let secret = ''
const schema = readFileSync('docs/schema.sql', 'utf8').replace(
  'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;',
  ''
)
const migrations = readdirSync('docs/migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort()
const privacy = readFileSync(
  'docs/migrations/20261019010000_family_branch_privacy.sql',
  'utf8'
)
async function as(user: string | null, sql: string, params: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${user ? 'authenticated' : 'anon'}`)
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
      user ?? ''
    ])
    return tx.query<Record<string, unknown>>(sql, params)
  })
}
const link = (account: string, person: string | null) =>
  as(admin, 'SELECT public.set_user_person($1,$2)', [account, person])
const create = async (person: string) =>
  String(
    (
      await as(admin, 'SELECT public.create_family_branch($1,$2) AS id', [
        person,
        'Private branch'
      ])
    ).rows[0].id
  )
const add = async (b: string, user = admin) =>
  String(
    (
      await as(
        user,
        'SELECT public.add_family_branch_person($1,$2::jsonb) AS id',
        [
          b,
          JSON.stringify({
            full_name: 'Private ancestor',
            gender: 'male',
            is_deceased: true,
            memorial_day: 5,
            memorial_month: 3,
            memorial_calendar: 'lunar'
          })
        ]
      )
    ).rows[0].id
  )
const visible = async (user: string, table: string, id: string, field = 'id') =>
  (await as(user, `SELECT * FROM public.${table} WHERE ${field}=$1`, [id])).rows
    .length

before(async () => {
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
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
  await db.exec(schema)
  for (const file of migrations)
    await db.exec(readFileSync(`docs/migrations/${file}`, 'utf8'))
  for (const [id, role, active] of [
    [admin, 'admin', true],
    [wife, 'editor', true],
    [husband, 'member', true],
    [outsider, 'editor', true],
    [reader, 'member', true],
    [pending, 'editor', false]
  ] as const) {
    await db.query('INSERT INTO auth.users VALUES ($1,$2,now())', [
      id,
      `${id}@example.test`
    ])
    await db.query(
      'UPDATE profiles SET role=$1::public.user_role_enum,is_active=$2 WHERE id=$3',
      [role, active, id]
    )
  }
  for (const [id, inlaw] of [
    [anchor, true],
    [partner, false],
    [other, false],
    [otherAnchor, true],
    [otherPartner, false],
    [secondSpouse, false]
  ] as const)
    await db.query(
      "INSERT INTO persons(id,full_name,gender,is_in_law) VALUES ($1,'Synthetic person','female',$2)",
      [id, inlaw]
    )
  await db.query(
    "INSERT INTO relationships(type,person_a,person_b) VALUES ('marriage',$1,$2),('marriage',$3,$4)",
    [anchor, partner, otherAnchor, otherPartner]
  )
  await link(wife, anchor)
  await link(husband, partner)
  await link(outsider, other)
  branch = await create(anchor)
  hiddenBranch = await create(otherAnchor)
  child = await add(branch, wife)
  secret = await add(hiddenBranch)
})
after(async () => db.close())

test('only mapped couple and active admin can read branch names, members, owned people and calendar fields', async () => {
  for (const account of [admin, wife, husband]) {
    assert.equal(await visible(account, 'family_branches', branch), 1)
    assert.equal(await visible(account, 'persons', child), 1)
  }
  for (const account of [outsider, reader, pending]) {
    assert.equal(await visible(account, 'family_branches', branch), 0)
    assert.equal(
      await visible(account, 'family_branch_members', branch, 'branch_id'),
      0
    )
    assert.equal(await visible(account, 'persons', child), 0)
    assert.equal(
      (
        await as(
          account,
          'SELECT id,memorial_day FROM persons WHERE family_branch_id=$1',
          [branch]
        )
      ).rows.length,
      0
    )
    assert.equal(
      (
        await as(
          account,
          'SELECT public.can_view_family_branch($1) AS allowed',
          [branch]
        )
      ).rows[0].allowed,
      false
    )
  }
  await assert.rejects(() => as(null, 'SELECT * FROM family_branches'))
  await assert.rejects(() =>
    as(null, 'SELECT public.can_view_person($1)', [child])
  )
  await assert.rejects(() =>
    as(pending, 'SELECT private.unique_branch_partner($1)', [anchor])
  )
  await assert.rejects(() =>
    as(outsider, 'SELECT private.valid_branch_partner($1,$2)', [
      anchor,
      partner
    ])
  )
  assert.equal(await visible(outsider, 'persons', anchor), 1)
  assert.equal(
    (
      await as(
        outsider,
        'SELECT * FROM relationships WHERE family_branch_id IS NULL'
      )
    ).rows.length,
    2
  )
  assert.equal(
    (
      await db.query(
        'SELECT * FROM family_branch_members WHERE branch_id=$1 AND person_id=$2',
        [branch, partner]
      )
    ).rows.length,
    0
  )
})

test('unrelated editor cannot mutate by UUID, create branches or use RPC to link hidden profiles', async () => {
  for (const account of [outsider, reader, husband, pending]) {
    await assert.rejects(() => add(branch, account))
    await assert.rejects(() =>
      as(account, 'SELECT public.create_family_branch($1,$2)', [
        anchor,
        'Spoof'
      ])
    )
    assert.equal(
      (
        await as(
          account,
          'UPDATE persons SET note=$2 WHERE id=$1 RETURNING id',
          [child, 'Spoof']
        )
      ).rows.length,
      0
    )
    assert.equal(
      (
        await as(
          account,
          'UPDATE family_branches SET name=$2 WHERE id=$1 RETURNING id',
          [branch, 'Spoof']
        )
      ).rows.length,
      0
    )
  }
  await assert.rejects(() =>
    as(
      wife,
      'SELECT public.add_family_branch_person($1,$2::jsonb,NULL,$3,$4)',
      [branch, '{}', 'member', secret]
    )
  )
  await assert.rejects(() =>
    as(
      wife,
      'INSERT INTO family_branch_members(branch_id,person_id) VALUES ($1,$2)',
      [branch, secret]
    )
  )
  await assert.rejects(() =>
    as(
      outsider,
      'INSERT INTO persons(full_name,gender,family_branch_id) VALUES ($1,$2,$3)',
      ['No', 'male', branch]
    )
  )
  await assert.rejects(
    () =>
      as(outsider, 'UPDATE persons SET is_in_law=false WHERE id=$1', [anchor]),
    /anchor/i
  )
  await as(
    wife,
    "INSERT INTO relationships(type,person_a,person_b,family_branch_id) VALUES ('biological_child',$1,$2,$3)",
    [anchor, child, branch]
  )
  assert.equal(
    (
      await as(
        outsider,
        'SELECT * FROM relationships WHERE family_branch_id=$1',
        [branch]
      )
    ).rows.length,
    0
  )
  assert.equal(
    (
      await as(
        outsider,
        'DELETE FROM relationships WHERE family_branch_id=$1 RETURNING id',
        [branch]
      )
    ).rows.length,
    0
  )
  await assert.rejects(() =>
    as(
      outsider,
      "INSERT INTO relationships(type,person_a,person_b,family_branch_id) VALUES ('biological_child',$1,$2,$3)",
      [anchor, child, branch]
    )
  )
  await as(wife, 'UPDATE persons SET note=$2 WHERE id=$1', [child, 'Allowed'])
})

test('identity and partner assignment cannot be spoofed, and membership/root never grant access', async () => {
  await assert.rejects(() => link(reader, anchor), /unique/i)
  await assert.rejects(() =>
    as(outsider, 'SELECT public.set_user_person($1,$2)', [outsider, anchor])
  )
  await assert.rejects(() =>
    as(outsider, 'UPDATE profiles SET person_id=$1 WHERE id=$2', [
      anchor,
      outsider
    ])
  )
  // The trigger remains defensive even if a future schema accidentally grants
  // self-profile writes. The migration itself preserves deny-by-default writes.
  await db.exec(
    'GRANT UPDATE(person_id) ON profiles TO authenticated; CREATE POLICY test_profile_write ON profiles FOR UPDATE TO authenticated USING (id=auth.uid()) WITH CHECK (id=auth.uid());'
  )
  await assert.rejects(
    () =>
      as(outsider, 'UPDATE profiles SET person_id=$1 WHERE id=$2', [
        anchor,
        outsider
      ]),
    /active admins/i
  )
  await db.exec(
    'DROP POLICY test_profile_write ON profiles; REVOKE UPDATE(person_id) ON profiles FROM authenticated;'
  )
  await assert.rejects(() =>
    as(wife, 'UPDATE family_branches SET partner_person_id=NULL WHERE id=$1', [
      branch
    ])
  )
  await assert.rejects(() =>
    as(admin, 'UPDATE family_branches SET partner_person_id=$2 WHERE id=$1', [
      branch,
      other
    ])
  )
  await as(
    admin,
    'INSERT INTO family_branch_members(branch_id,person_id) VALUES ($1,$2)',
    [branch, other]
  )
  await as(admin, 'UPDATE family_branches SET root_person_id=$2 WHERE id=$1', [
    branch,
    other
  ])
  assert.equal(await visible(outsider, 'family_branches', branch), 0)
  await link(wife, null)
  assert.equal(await visible(wife, 'persons', child), 0)
  await link(wife, anchor)
  await as(
    admin,
    'UPDATE family_branches SET partner_person_id=NULL WHERE id=$1',
    [branch]
  )
  assert.equal(await visible(husband, 'family_branches', branch), 0)
  await db.exec(privacy)
  assert.equal(
    await visible(husband, 'family_branches', branch),
    0,
    'replay must preserve admin revocation'
  )
  await as(
    admin,
    'UPDATE family_branches SET partner_person_id=$2 WHERE id=$1',
    [branch, partner]
  )
})

test('main marriage revocation applies immediately; ambiguous distinct spouses require admin choice', async () => {
  await as(
    wife,
    "DELETE FROM relationships WHERE type='marriage' AND person_a=$1 AND person_b=$2",
    [anchor, partner]
  )
  assert.equal(await visible(husband, 'family_branches', branch), 0)
  await as(
    admin,
    "INSERT INTO relationships(type,person_a,person_b) VALUES ('marriage',$1,$2)",
    [anchor, partner]
  )
  assert.equal(
    await visible(husband, 'family_branches', branch),
    0,
    're-marriage needs explicit admin authorization'
  )
  await as(
    admin,
    'UPDATE family_branches SET partner_person_id=$2 WHERE id=$1',
    [branch, partner]
  )
  assert.equal(await visible(husband, 'family_branches', branch), 1)
  await db.query(
    "INSERT INTO relationships(type,person_a,person_b) VALUES ('marriage',$1,$2),('marriage',$2,$1)",
    [anchor, secondSpouse]
  )
  const ambiguous = await create(anchor)
  assert.equal(
    (
      await db.query<{ partner_person_id: string | null }>(
        'SELECT partner_person_id FROM family_branches WHERE id=$1',
        [ambiguous]
      )
    ).rows[0].partner_person_id,
    null
  )
  await as(
    admin,
    'UPDATE family_branches SET partner_person_id=$2 WHERE id=$1',
    [ambiguous, partner]
  )
  assert.equal(await visible(husband, 'family_branches', ambiguous), 1)
})

test('shared owned person is visible through accessible membership while its owning branch remains hidden', async () => {
  await as(
    admin,
    'INSERT INTO family_branch_members(branch_id,person_id) VALUES ($1,$2)',
    [branch, secret]
  )
  assert.equal(await visible(wife, 'persons', secret), 1)
  assert.equal(await visible(wife, 'family_branches', hiddenBranch), 0)
  assert.equal(
    await visible(wife, 'family_branch_members', hiddenBranch, 'branch_id'),
    0
  )
  await as(
    admin,
    'DELETE FROM family_branch_members WHERE branch_id=$1 AND person_id=$2',
    [branch, secret]
  )
})

test('avatar direct reads/list/signing prerequisites follow person scope for normalized and historical paths', async () => {
  await db.query('UPDATE persons SET avatar_url=$2 WHERE id=$1', [
    child,
    `https://example.test/storage/v1/object/public/avatars/${child}.jpg`
  ])
  await db.query('UPDATE persons SET avatar_url=$2 WHERE id=$1', [
    secret,
    `${secret}.jpg`
  ])
  await db.query(
    "INSERT INTO storage.objects VALUES ($1,'avatars',$2),($3,'avatars',$4)",
    [uid(30), `${child}.jpg`, uid(31), `${secret}.jpg`]
  )
  for (const account of [wife, husband]) {
    assert.equal(
      (
        await as(
          account,
          "SELECT name FROM storage.objects WHERE bucket_id='avatars'"
        )
      ).rows.length,
      1
    )
    assert.equal(
      (
        await as(
          account,
          "SELECT name FROM storage.objects WHERE bucket_id='avatars' AND name=$1",
          [`${secret}.jpg`]
        )
      ).rows.length,
      0
    )
  }
  assert.equal(
    (
      await as(
        outsider,
        "SELECT name FROM storage.objects WHERE bucket_id='avatars'"
      )
    ).rows.length,
    0
  )
  assert.equal(
    (
      await as(
        admin,
        "SELECT name FROM storage.objects WHERE bucket_id='avatars'"
      )
    ).rows.length,
    2
  )
  assert.equal(
    (
      await as(
        outsider,
        'UPDATE storage.objects SET name=$2 WHERE id=$1 RETURNING id',
        [uid(30), 'spoof.jpg']
      )
    ).rows.length,
    0
  )
  await assert.rejects(
    () =>
      as(outsider, 'UPDATE persons SET avatar_url=$2 WHERE id=$1', [
        other,
        `${secret}.jpg`
      ]),
    /visible person/i
  )
  await assert.rejects(
    () =>
      as(outsider, 'UPDATE persons SET avatar_url=$2 WHERE id=$1', [
        other,
        `https://example.test/storage/v1/object/sign/avatars/${secret}.jpg?token=guess`
      ]),
    /visible person/i
  )
  await assert.rejects(() =>
    as(outsider, "INSERT INTO storage.objects VALUES ($1,'avatars',$2)", [
      uid(32),
      `${child}_spoof.jpg`
    ])
  )
  assert.equal(
    (
      await as(
        outsider,
        'DELETE FROM storage.objects WHERE id=$1 RETURNING id',
        [uid(31)]
      )
    ).rows.length,
    0
  )
  // Even an old alias written by an admin cannot override a canonical owner.
  await db.query('UPDATE persons SET avatar_url=$2 WHERE id=$1', [
    other,
    `${secret}.jpg`
  ])
  assert.equal(
    (
      await as(outsider, 'SELECT * FROM storage.objects WHERE name=$1', [
        `${secret}.jpg`
      ])
    ).rows.length,
    0
  )
  await db.query('UPDATE persons SET avatar_url=NULL WHERE id=$1', [other])
  assert.equal(
    (
      await as(
        wife,
        "INSERT INTO storage.objects VALUES ($1,'avatars',$2) RETURNING name",
        [uid(32), `${child}_new.jpg`]
      )
    ).rows.length,
    1
  )
  await as(wife, 'UPDATE persons SET avatar_url=$2 WHERE id=$1', [
    child,
    `${child}_new.jpg`
  ])
})

test('intake approval cannot probe hidden names or modify hidden people through its definer RPC', async () => {
  const token = 'd'.repeat(64)
  await as(admin, 'UPDATE persons SET generation=1 WHERE id=$1', [anchor])
  await as(
    admin,
    "INSERT INTO family_intake_links(token_hash,title,root_person_id,expires_at) VALUES (md5($1),'Main intake',$2,now()+interval '1 day')",
    [token, anchor]
  )
  const payload = {
    anchor_id: anchor,
    sender_name: 'Synthetic sender',
    sender_contact: 'example.test',
    note: '',
    people: [
      {
        client_id: uid(50),
        relation: 'child',
        relative_to: 'anchor',
        data: {
          full_name: 'Private ancestor',
          gender: 'male',
          is_deceased: false
        }
      }
    ]
  }
  const receipt = String(
    (
      await as(null, 'SELECT public.submit_family_intake($1,$2::jsonb) AS id', [
        token,
        JSON.stringify(payload)
      ])
    ).rows[0].id
  )
  const review = (value: unknown) =>
    as(
      outsider,
      "SELECT public.review_family_intake($1,'approved',$2::jsonb,'')",
      [receipt, JSON.stringify(value)]
    )
  await assert.rejects(
    () => review({ ...payload, anchor_id: secret }),
    /Anchor person/i
  )
  await assert.rejects(
    () =>
      review({
        ...payload,
        people: [
          {
            ...payload.people[0],
            existing_person_id: secret,
            update_existing: true
          }
        ]
      }),
    /Matched person/i
  )
  // A duplicate warning here would disclose an exclusively auxiliary name.
  await review(payload)
  assert.equal(await visible(outsider, 'persons', secret), 0)
})

test('existing branch parents can be joined as spouses without duplicating profiles or changing the main lineage', async () => {
  const mainBefore = (
    await db.query(
      'SELECT * FROM persons WHERE family_branch_id IS NULL ORDER BY id'
    )
  ).rows
  const parents: string[] = []
  for (const [name, gender] of [
    ['Father', 'male'],
    ['Mother', 'female']
  ]) {
    const result = await as(
      admin,
      'SELECT public.add_family_branch_person($1,$2::jsonb,$3,$4) AS id',
      [branch, JSON.stringify({ full_name: name, gender }), anchor, 'parent']
    )
    parents.push(String(result.rows[0].id))
  }
  const countBefore = (await db.query('SELECT count(*) AS count FROM persons'))
    .rows
  const membershipsBefore = (
    await db.query(
      'SELECT * FROM family_branch_members WHERE branch_id=$1 ORDER BY person_id',
      [branch]
    )
  ).rows
  const connect = (user: string, a: string, b: string) =>
    as(user, 'SELECT public.add_family_branch_person($1,$2::jsonb,$3,$4,$5)', [
      branch,
      '{}',
      b,
      'spouse',
      a
    ])
  await assert.rejects(() => connect(outsider, parents[0], parents[1]))
  await connect(admin, parents[0], parents[1])
  await assert.rejects(
    () => connect(admin, parents[1], parents[0]),
    /Spouse relationship already exists/
  )
  assert.deepEqual(
    (await db.query('SELECT count(*) AS count FROM persons')).rows,
    countBefore
  )
  assert.deepEqual(
    (
      await db.query(
        'SELECT * FROM persons WHERE family_branch_id IS NULL ORDER BY id'
      )
    ).rows,
    mainBefore
  )
  assert.deepEqual(
    (
      await db.query(
        'SELECT * FROM family_branch_members WHERE branch_id=$1 ORDER BY person_id',
        [branch]
      )
    ).rows,
    membershipsBefore
  )
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM relationships WHERE type='marriage' AND family_branch_id=$1 AND ((person_a=$2 AND person_b=$3) OR (person_a=$3 AND person_b=$2))",
        [branch, ...parents]
      )
    ).rows.length,
    1
  )
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM relationships WHERE type='biological_child' AND family_branch_id=$1 AND person_b=$2 AND person_a=ANY($3::uuid[])",
        [branch, anchor, parents]
      )
    ).rows.length,
    2
  )
  assert.equal(
    (
      await db.query(
        'SELECT 1 FROM relationships WHERE family_branch_id IS NULL AND (person_a=ANY($1::uuid[]) OR person_b=ANY($1::uuid[]))',
        [parents]
      )
    ).rows.length,
    0
  )
})

test('full restore preserves spouse choices and existing local account links, clears removed identities and accepts legacy backups', async () => {
  const payload: Record<string, unknown> = {}
  for (const table of [
    'persons',
    'relationships',
    'person_details_private',
    'custom_events',
    'family_branches',
    'family_branch_members'
  ])
    payload[table] = (await db.query(`SELECT * FROM public.${table}`)).rows
  await link(reader, secret)
  await as(admin, 'SELECT public.import_family_backup($1::jsonb)', [
    JSON.stringify(payload)
  ])
  assert.equal(
    (
      await db.query<{ person_id: string | null }>(
        'SELECT person_id FROM profiles WHERE id=$1',
        [wife]
      )
    ).rows[0].person_id,
    anchor
  )
  assert.equal(
    (
      await db.query<{ person_id: string | null }>(
        'SELECT person_id FROM profiles WHERE id=$1',
        [reader]
      )
    ).rows[0].person_id,
    secret
  )
  assert.equal(
    (
      await db.query<{ partner_person_id: string | null }>(
        'SELECT partner_person_id FROM family_branches WHERE id=$1',
        [branch]
      )
    ).rows[0].partner_person_id,
    partner
  )
  await as(
    admin,
    "DELETE FROM relationships WHERE type='marriage' AND family_branch_id IS NULL AND person_a=$1 AND person_b=$2",
    [anchor, partner]
  )
  const revoked = {
    ...payload,
    relationships: (await db.query('SELECT * FROM relationships')).rows
  }
  await as(admin, 'SELECT public.import_family_backup($1::jsonb)', [
    JSON.stringify(revoked)
  ])
  assert.equal(
    (
      await db.query<{ partner_person_id: string | null }>(
        'SELECT partner_person_id FROM family_branches WHERE id=$1',
        [branch]
      )
    ).rows[0].partner_person_id,
    null
  )
  assert.equal(await visible(husband, 'family_branches', branch), 0)
  const legacy = { ...payload }
  delete legacy.family_branches
  delete legacy.family_branch_members
  legacy.persons = (payload.persons as { family_branch_id: unknown }[]).filter(
    (p) => p.family_branch_id === null
  )
  legacy.relationships = (
    payload.relationships as { family_branch_id: unknown }[]
  ).filter((r) => r.family_branch_id === null)
  await as(admin, 'SELECT public.import_family_backup($1::jsonb)', [
    JSON.stringify(legacy)
  ])
  assert.equal(
    (
      await db.query<{ person_id: string | null }>(
        'SELECT person_id FROM profiles WHERE id=$1',
        [reader]
      )
    ).rows[0].person_id,
    null
  )
  assert.equal(
    (
      await db.query<{ person_id: string | null }>(
        'SELECT person_id FROM profiles WHERE id=$1',
        [wife]
      )
    ).rows[0].person_id,
    anchor
  )
})

test('privacy upgrade accepts CRLF and differently indented existing backup functions without changing data', async () => {
  const baseMigration = readFileSync(
    'docs/migrations/20261019000000_family_branches.sql',
    'utf8'
  )
  const baseFunction = baseMigration.match(
    /CREATE OR REPLACE FUNCTION public\.import_family_backup\(payload jsonb\)[\s\S]*?\$\$;/
  )![0]
  const tables = [
    'persons',
    'relationships',
    'person_details_private',
    'custom_events',
    'family_branches',
    'family_branch_members'
  ]
  for (const [newline, begin] of [
    ['\r\n', 'BEGIN'],
    ['\n', '  BEGIN']
  ]) {
    await db.exec(
      baseFunction
        .replace(/\r?\n/g, newline)
        .replace(`${newline}BEGIN`, `${newline}${begin}`)
    )
    const payload: Record<string, unknown> = {}
    for (const table of tables)
      payload[table] = (
        await db.query(`SELECT * FROM ${table} ORDER BY 1`)
      ).rows
    const profilesBefore = (
      await db.query('SELECT * FROM profiles ORDER BY id')
    ).rows
    await db.exec(privacy)
    for (const table of tables)
      assert.deepEqual(
        (await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows,
        payload[table]
      )
    assert.deepEqual(
      (await db.query('SELECT * FROM profiles ORDER BY id')).rows,
      profilesBefore
    )
    await as(admin, 'SELECT public.import_family_backup($1::jsonb)', [
      JSON.stringify(payload)
    ])
    assert.equal(
      (
        await db.query<{ person_id: string | null }>(
          'SELECT person_id FROM profiles WHERE id=$1',
          [wife]
        )
      ).rows[0].person_id,
      anchor
    )
  }
})

test('complete setup replay replaces permissive legacy policies and keeps wrappers non-definer', async () => {
  branch = await create(anchor)
  child = await add(branch)
  for (let n = 0; n < 2; n++) {
    await db.exec(schema)
    for (const file of migrations)
      await db.exec(readFileSync(`docs/migrations/${file}`, 'utf8'))
    assert.equal(await visible(outsider, 'family_branches', branch), 0)
    assert.equal(await visible(outsider, 'persons', child), 0)
    assert.equal(await visible(wife, 'family_branches', branch), 1)
  }
  const wrappers = await db.query<{ prosecdef: boolean }>(
    "SELECT prosecdef FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('can_view_person','can_view_family_branch','set_user_person','import_family_backup')"
  )
  assert.equal(wrappers.rows.length, 4)
  assert.ok(wrappers.rows.every((p) => !p.prosecdef))
})
