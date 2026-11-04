import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

import { IntakePayload } from '../types/intake'
import { cleanPublicIntake, validateIntake } from '../utils/intake'
import { installAuthSessions } from './helpers/auth-sessions'

const db = new PGlite()
const admin = '11111111-1111-4111-8111-111111111111'
const editor = '22222222-2222-4222-8222-222222222222'
const member = '33333333-3333-4333-8333-333333333333'
const root = '44444444-4444-4444-8444-444444444444'
const outside = '55555555-5555-4555-8555-555555555555'
const first = '66666666-6666-4666-8666-666666666666'
const second = '77777777-7777-4777-8777-777777777777'
const third = '88888888-8888-4888-8888-888888888888'
const token = 'a'.repeat(64)
const newMigration = readFileSync(
  'docs/migrations/20261014020000_family_intake_and_memorial.sql',
  'utf8'
)
let receipt = ''
let published: string[] = []

before(async () => {
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY, bucket_id text, name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
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
    .sort())
    await db.exec(readFileSync(`docs/migrations/${file}`, 'utf8'))
  await db.exec(newMigration)
  await db.exec(
    readFileSync(
      'docs/migrations/20261016000000_intake_link_management.sql',
      'utf8'
    )
  )
  await db.exec(
    readFileSync(
      'docs/migrations/20261102000000_intake_submission_delete.sql',
      'utf8'
    )
  )
  for (const [id, role, active] of [
    [admin, 'admin', true],
    [editor, 'editor', true],
    [member, 'member', true]
  ] as const) {
    await db.query<Record<string, unknown>>(
      'INSERT INTO auth.users VALUES ($1,$2,now())',
      [id, `${role}@example.com`]
    )
    await db.query<Record<string, unknown>>(
      'UPDATE public.profiles SET role=$1::public.user_role_enum,is_active=$2 WHERE id=$3',
      [role, active, id]
    )
  }
  await db.query<Record<string, unknown>>(
    "INSERT INTO public.persons(id,full_name,gender,generation,birth_year) VALUES ($1,'Ancestor','male',1,1800),($2,'Other branch','female',1,1805)",
    [root, outside]
  )
  await db.query<Record<string, unknown>>(
    'INSERT INTO public.person_details_private(person_id,phone_number) VALUES ($1,$2)',
    [root, 'private contact']
  )
  await db.query<Record<string, unknown>>(
    "INSERT INTO public.family_intake_links(token_hash,title,root_person_id,expires_at,created_by) VALUES ($1,$2,$3,now()+interval '90 days',$4)",
    [
      createHash('md5').update(token).digest('hex'),
      'Family branch',
      root,
      admin
    ]
  )
})
after(async () => {
  await db.close()
})

test('shareable links restrict tokens to editors and preserve submissions on deletion', async () => {
  const original = 'b'.repeat(64)
  const replacement = 'c'.repeat(64)
  const created = await asRole(
    'authenticated',
    editor,
    `INSERT INTO family_intake_links(token_hash,share_token,title,root_person_id,expires_at)
     VALUES (md5($1),$1,'Reusable link',$2,now()+interval '1 day') RETURNING id`,
    [original, outside]
  )
  const id = created.rows[0].id
  const sent = await asRole(
    'anon',
    null,
    'SELECT submit_family_intake($1,$2::jsonb) AS id',
    [original, JSON.stringify({ ...family(), anchor_id: outside })]
  )
  const sql = readFileSync(
    'docs/migrations/20261016000000_intake_link_management.sql',
    'utf8'
  )
  await db.exec(sql)
  await db.exec(sql)
  assert.equal(
    (
      await asRole(
        'authenticated',
        admin,
        'SELECT share_token FROM family_intake_links WHERE id=$1',
        [id]
      )
    ).rows[0].share_token,
    original
  )
  assert.equal(
    (
      await asRole(
        'authenticated',
        member,
        'SELECT share_token FROM family_intake_links WHERE id=$1',
        [id]
      )
    ).rows.length,
    0
  )
  await assert.rejects(
    asRole(
      'anon',
      null,
      'SELECT share_token FROM family_intake_links WHERE id=$1',
      [id]
    ),
    /permission denied/
  )
  assert.equal(
    (
      await asRole(
        'authenticated',
        member,
        'UPDATE family_intake_links SET is_active=false,deleted_at=now() WHERE id=$1 RETURNING id',
        [id]
      )
    ).rows.length,
    0
  )
  await assert.rejects(
    asRole(
      'authenticated',
      editor,
      'UPDATE family_intake_links SET share_token=$1 WHERE id=$2',
      [replacement, id]
    ),
    /intake_share_token_check/
  )
  // Model an old link, then replace its token without resetting expiry or quotas.
  await asRole(
    'authenticated',
    editor,
    'UPDATE family_intake_links SET share_token=NULL WHERE id=$1',
    [id]
  )
  await asRole(
    'authenticated',
    editor,
    'UPDATE family_intake_links SET share_token=$1,token_hash=md5($1) WHERE id=$2 AND share_token IS NULL',
    [replacement, id]
  )
  assert.equal(
    (
      await asRole(
        'anon',
        null,
        'SELECT get_family_intake_options($1) AS options',
        [original]
      )
    ).rows[0].options,
    null
  )
  assert.ok(
    (
      await asRole(
        'anon',
        null,
        'SELECT get_family_intake_options($1) AS options',
        [replacement]
      )
    ).rows[0].options
  )
  await asRole(
    'authenticated',
    editor,
    'UPDATE family_intake_links SET is_active=false,deleted_at=now() WHERE id=$1',
    [id]
  )
  assert.equal(
    (
      await asRole(
        'anon',
        null,
        'SELECT get_family_intake_options($1) AS options',
        [replacement]
      )
    ).rows[0].options,
    null
  )
  await assert.rejects(
    asRole('anon', null, 'SELECT submit_family_intake($1,$2::jsonb)', [
      replacement,
      JSON.stringify({ ...family(), anchor_id: outside })
    ])
  )
  assert.equal(
    (
      await asRole(
        'authenticated',
        editor,
        'SELECT id FROM family_intake_submissions WHERE id=$1',
        [sent.rows[0].id]
      )
    ).rows.length,
    1
  )
  await assert.rejects(
    asRole(
      'authenticated',
      editor,
      'UPDATE family_intake_links SET is_active=true WHERE id=$1',
      [id]
    ),
    /intake_deleted_link_check/
  )
})

async function asRole(
  role: 'anon' | 'authenticated',
  user: string | null,
  sql: string,
  args: unknown[] = []
) {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${role}`)
    await tx.query<Record<string, unknown>>(
      "SELECT set_config('request.jwt.claim.sub',$1,true)",
      [user || '']
    )
    return tx.query<Record<string, unknown>>(sql, args)
  })
}
function family(): IntakePayload {
  return {
    anchor_id: root,
    sender_name: 'Sender',
    sender_contact: 'sender@example.com',
    note: '',
    people: [
      {
        client_id: first,
        relation: 'child',
        relative_to: 'anchor',
        data: {
          full_name: 'Historical child',
          gender: 'male',
          is_deceased: true,
          birth_year_from: 1880,
          birth_year_to: 1885,
          death_year_from: 1937,
          death_year_to: 1939,
          memorial_day: 5,
          memorial_month: 3,
          memorial_calendar: 'lunar',
          memorial_is_leap_month: false,
          memorial_note: 'Family custom'
        }
      },
      {
        client_id: second,
        relation: 'spouse',
        relative_to: first,
        data: { full_name: 'Spouse', gender: 'female', is_deceased: true }
      },
      {
        client_id: third,
        relation: 'child',
        relative_to: first,
        other_parent_ref: second,
        data: {
          full_name: 'Grandchild',
          gender: 'male',
          is_deceased: false,
          birth_year: 1910
        }
      }
    ]
  }
}
async function send(payload = family(), linkToken = token) {
  const result = await asRole(
    'anon',
    null,
    'SELECT public.submit_family_intake($1,$2::jsonb) AS id',
    [linkToken, JSON.stringify(payload)]
  )
  return result.rows[0].id as string
}
async function review(
  id: string,
  payload: IntakePayload,
  actor = editor,
  decision = 'approved',
  note = ''
) {
  return asRole(
    'authenticated',
    actor,
    'SELECT public.review_family_intake($1,$2,$3::jsonb,$4) AS ids',
    [id, decision, JSON.stringify(payload), note]
  )
}

test('public links expose only scoped names and generations, not profiles or submissions', async () => {
  const options = await asRole(
    'anon',
    null,
    'SELECT public.get_family_intake_options($1) AS options',
    [token]
  )
  assert.deepEqual(options.rows[0].options, {
    title: 'Family branch',
    root_id: root,
    people: [{ id: root, full_name: 'Ancestor', generation: 1 }]
  })
  for (const table of [
    'persons',
    'person_details_private',
    'family_intake_links',
    'family_intake_submissions'
  ])
    await assert.rejects(
      asRole('anon', null, `SELECT * FROM public.${table}`),
      /permission denied/
    )
  assert.equal(
    (
      await asRole(
        'anon',
        null,
        'SELECT public.get_family_intake_options($1) AS options',
        ['b'.repeat(64)]
      )
    ).rows[0].options,
    null
  )
})

test('anonymous submissions are staged and cannot smuggle publication/match fields', async () => {
  const payload = family()
  Object.assign(payload.people[0], {
    existing_person_id: root,
    update_existing: true,
    confirm_new: true
  })
  receipt = await send(payload)
  const queue = await db.query<Record<string, unknown>>(
    'SELECT payload,status FROM public.family_intake_submissions WHERE id=$1',
    [receipt]
  )
  assert.equal(queue.rows[0].status, 'pending')
  const stored = queue.rows[0].payload as IntakePayload
  assert.equal(stored.people[0].existing_person_id, undefined)
  assert.equal(stored.people[0].update_existing, undefined)
  assert.equal(
    (
      await db.query<Record<string, unknown>>(
        'SELECT count(*) AS n FROM persons'
      )
    ).rows[0].n,
    2
  )
  assert.equal(
    (
      await asRole(
        'authenticated',
        member,
        'SELECT * FROM public.family_intake_submissions'
      )
    ).rows.length,
    0
  )
  await assert.rejects(review(receipt, family(), member), /Access denied/)
  await assert.rejects(
    asRole(
      'anon',
      null,
      'SELECT public.review_family_intake($1,$2,$3::jsonb,$4)',
      [receipt, 'approved', JSON.stringify(family()), '']
    ),
    /permission denied/
  )
  await assert.rejects(
    asRole(
      'authenticated',
      editor,
      "UPDATE public.family_intake_submissions SET status='approved' WHERE id=$1",
      [receipt]
    ),
    /permission denied/
  )
})

test('active editor approves a whole family, infers generations, preserves custom memorial, and cannot approve twice', async () => {
  const result = await review(receipt, family())
  published = result.rows[0].ids as string[]
  const rows = await db.query<Record<string, unknown>>(
    'SELECT id,generation,memorial_day,birth_year,death_year FROM persons WHERE id=ANY($1::uuid[]) ORDER BY generation,full_name',
    [published]
  )
  assert.deepEqual(
    rows.rows.map((p) => p.generation),
    [2, 2, 3]
  )
  assert.equal(rows.rows.find((p) => p.id === published[0])?.memorial_day, 5)
  assert.equal(rows.rows.find((p) => p.id === published[0])?.death_year, null)
  assert.equal(
    (
      await db.query<Record<string, unknown>>(
        'SELECT count(*) AS n FROM relationships'
      )
    ).rows[0].n,
    4
  )
  await assert.rejects(review(receipt, family()), /already reviewed/)
  await db.exec(newMigration)
  assert.equal(
    (
      await db.query<Record<string, unknown>>(
        'SELECT status FROM family_intake_submissions WHERE id=$1',
        [receipt]
      )
    ).rows[0].status,
    'approved'
  )
})

test('review failures roll back every new person and relation; duplicates require explicit matching', async () => {
  const payload = family()
  payload.people = payload.people.slice(0, 2)
  payload.people[0].data.full_name = 'Temporary new child'
  const id = await send(payload)
  const before = await db.query<Record<string, unknown>>(
    'SELECT count(*) AS n FROM persons'
  )
  await assert.rejects(review(id, payload), /Possible duplicate/)
  assert.deepEqual(
    await db.query<Record<string, unknown>>(
      'SELECT count(*) AS n FROM persons'
    ),
    before
  )
  assert.equal(
    (
      await db.query<Record<string, unknown>>(
        'SELECT status FROM family_intake_submissions WHERE id=$1',
        [id]
      )
    ).rows[0].status,
    'pending'
  )
  payload.people[1].existing_person_id = published[1]
  await review(id, payload)
  assert.equal(
    (
      await db.query<Record<string, unknown>>(
        'SELECT count(*) AS n FROM persons'
      )
    ).rows[0].n,
    Number(before.rows[0].n) + 1
  )
})

test('matching an existing ancestor as a child cannot introduce ancestry cycles', async () => {
  const payload = family()
  payload.people = payload.people.slice(0, 1)
  payload.anchor_id = published[0]
  const id = await send(payload)
  payload.people[0].existing_person_id = root
  await assert.rejects(review(id, payload), /ancestry cycle/)
})

test('duplicate submissions can request information or be rejected without fixing approval data', async () => {
  const payload = family()
  payload.people = payload.people.slice(0, 1)
  payload.people[0].data.full_name = 'Ancestor'
  const id = await send(payload)
  await assert.rejects(review(id, payload), /Possible duplicate/)
  await assert.rejects(review(id, payload, admin, 'rejected'), /explain/)
  // An unfinished edit is irrelevant to a decision that does not publish people.
  const invalidDraft = {} as IntakePayload
  await review(
    id,
    invalidDraft,
    editor,
    'needs_info',
    'Please confirm this duplicate'
  )
  await review(id, invalidDraft, admin, 'rejected', 'Already entered manually')
  const row = await db.query<Record<string, unknown>>(
    'SELECT status,reviewer_note FROM family_intake_submissions WHERE id=$1',
    [id]
  )
  assert.equal(row.rows[0].status, 'rejected')
  assert.equal(row.rows[0].reviewer_note, 'Already entered manually')
})

test('only active reviewers can delete unfinished submissions without touching the tree or other submissions', async () => {
  const migration = readFileSync(
    'docs/migrations/20261102000000_intake_submission_delete.sql',
    'utf8'
  )
  await db.exec(migration)
  await db.exec(migration)
  const id = await send()
  const other = await send()
  const treeBefore = (await db.query('SELECT * FROM persons ORDER BY id')).rows
  const relationshipsBefore = (
    await db.query('SELECT * FROM relationships ORDER BY id')
  ).rows
  const linksBefore = (
    await db.query('SELECT * FROM family_intake_links ORDER BY id')
  ).rows
  const remove = (actor: string, submissionId = id) =>
    asRole(
      'authenticated',
      actor,
      'DELETE FROM family_intake_submissions WHERE id=$1 RETURNING id',
      [submissionId]
    )
  await assert.rejects(
    asRole('anon', null, 'DELETE FROM family_intake_submissions WHERE id=$1', [
      id
    ]),
    /permission denied/
  )
  assert.equal((await remove(member)).rows.length, 0)
  await db.query('UPDATE profiles SET is_active=false WHERE id=$1', [editor])
  try {
    assert.equal((await remove(editor)).rows.length, 0)
  } finally {
    await db.query('UPDATE profiles SET is_active=true WHERE id=$1', [editor])
  }
  assert.equal((await remove(editor)).rows.length, 1)
  assert.equal((await remove(admin)).rows.length, 0)
  await assert.rejects(review(id, family()), /missing or already reviewed/)
  await review(other, family(), admin, 'needs_info', 'Incomplete')
  assert.equal((await remove(admin, other)).rows.length, 1)
  // The approved receipt from earlier tests must remain, including its tree data.
  assert.equal((await remove(admin, receipt)).rows.length, 0)
  const rejected = await send()
  await review(rejected, family(), editor, 'rejected', 'Duplicate')
  assert.equal((await remove(editor, rejected)).rows.length, 0)
  assert.deepEqual(
    (await db.query('SELECT * FROM persons ORDER BY id')).rows,
    treeBefore
  )
  assert.deepEqual(
    (await db.query('SELECT * FROM relationships ORDER BY id')).rows,
    relationshipsBefore
  )
  assert.deepEqual(
    (await db.query('SELECT * FROM family_intake_links ORDER BY id')).rows,
    linksBefore
  )
  assert.equal(
    (
      await db.query('SELECT id FROM family_intake_submissions WHERE id=$1', [
        rejected
      ])
    ).rows.length,
    1
  )
})

test('existing profile updates are explicit; needs-information requires a reason and can later be approved', async () => {
  const payload = family()
  payload.people = payload.people.slice(0, 1)
  payload.people[0].relation = 'self'
  const id = await send(payload)
  await assert.rejects(review(id, payload, admin, 'needs_info'), /explain/)
  await review(id, payload, admin, 'needs_info', 'Confirm family custom')
  await review(id, payload, admin, 'approved')
  assert.equal(
    (
      await db.query<Record<string, unknown>>(
        'SELECT full_name FROM persons WHERE id=$1',
        [root]
      )
    ).rows[0].full_name,
    'Ancestor'
  )
  const update = family()
  update.people = update.people.slice(0, 1)
  update.people[0].relation = 'self'
  const updateId = await send(update)
  update.people[0].update_existing = true
  await review(updateId, update, admin)
  assert.equal(
    (
      await db.query<Record<string, unknown>>(
        'SELECT memorial_day,death_year FROM persons WHERE id=$1',
        [root]
      )
    ).rows[0].memorial_day,
    5
  )
})

test('invalid dates, relationships, out-of-branch anchors and pending editor are rejected even via direct RPC', async () => {
  for (const change of [
    { birth_month: 2, birth_day: 30 },
    { memorial_calendar: 'solar', memorial_month: 4, memorial_day: 31 },
    { memorial_day: '5' },
    { birth_year_from: 1886 },
    { is_deceased: false },
    { id: outside },
    { memorial_is_leap_month: 'true' }
  ]) {
    const payload = family()
    Object.assign(payload.people[0].data, change)
    assert.equal(validateIntake(payload), false)
    await assert.rejects(send(payload))
  }
  const payload = family()
  payload.anchor_id = outside
  await assert.rejects(send(payload), /outside this branch/)
  const forward = family()
  forward.people[0].relative_to = third
  await assert.rejects(send(forward), /relationship/)
  await db.query<Record<string, unknown>>(
    'UPDATE profiles SET is_active=false WHERE id=$1',
    [editor]
  )
  const pending = await send()
  await assert.rejects(review(pending, family()), /Access denied/)
  await db.query<Record<string, unknown>>(
    'UPDATE profiles SET is_active=true WHERE id=$1',
    [editor]
  )
  const clean = cleanPublicIntake(family())
  assert.equal(validateIntake(clean), true)
})

test('disabled, expired and deleted-root links fail; member cannot create links, editor can disable another editor link', async () => {
  await assert.rejects(
    asRole(
      'authenticated',
      member,
      "INSERT INTO family_intake_links(token_hash,title,root_person_id,expires_at) VALUES ($1,$2,$3,now()+interval '1 day')",
      [
        createHash('md5').update('c'.repeat(64)).digest('hex'),
        'Forbidden',
        root
      ]
    ),
    /row-level security/
  )
  await asRole(
    'authenticated',
    editor,
    'UPDATE family_intake_links SET is_active=false WHERE token_hash=$1',
    [createHash('md5').update(token).digest('hex')]
  )
  await assert.rejects(send(), /expired collection link/)
  await db.query<Record<string, unknown>>(
    "UPDATE family_intake_links SET is_active=true,expires_at=now()-interval '1 day' WHERE deleted_at IS NULL"
  )
  await assert.rejects(send(), /expired collection link/)
  await db.query<Record<string, unknown>>(
    "UPDATE family_intake_links SET expires_at=now()+interval '1 day'"
  )
})

test('database submission quotas cannot be bypassed by anonymous direct RPC calls', async () => {
  const quotaToken = 'd'.repeat(64)
  await db.query<Record<string, unknown>>(
    "INSERT INTO family_intake_links(token_hash,title,root_person_id,expires_at,created_by) VALUES ($1,$2,$3,now()+interval '1 day',$4)",
    [
      createHash('md5').update(quotaToken).digest('hex'),
      'Quota test',
      root,
      admin
    ]
  )
  for (let i = 0; i < 30; i++) await send(family(), quotaToken)
  await assert.rejects(send(family(), quotaToken), /limit reached/)
})

test('reviewers must supply a generation for an unknown branch and cannot contradict a known parent generation', async () => {
  const payload = family()
  payload.people = payload.people.slice(0, 1)
  payload.people[0].data.full_name = 'Known generation child'
  const knownId = await send(payload)
  payload.people[0].generation = 7
  await assert.rejects(review(knownId, payload), /conflicts/)
  payload.people[0].generation = 2
  await review(knownId, payload)
  await db.query<Record<string, unknown>>(
    'UPDATE persons SET generation=NULL WHERE id=$1',
    [root]
  )
  const unknown = family()
  unknown.people = unknown.people.slice(0, 1)
  unknown.people[0].data.full_name = 'Reviewed generation child'
  const unknownId = await send(unknown)
  await assert.rejects(
    review(unknownId, unknown),
    /Set the reviewed generation/
  )
  unknown.people[0].generation = 4
  const result = await review(unknownId, unknown)
  const ids = result.rows[0].ids as string[]
  assert.equal(
    (
      await db.query<Record<string, unknown>>(
        'SELECT generation FROM persons WHERE id=$1',
        [ids[0]]
      )
    ).rows[0].generation,
    4
  )
  await db.query<Record<string, unknown>>(
    'UPDATE persons SET generation=1 WHERE id=$1',
    [root]
  )
})

test('backup import preserves memorial fields and does not erase collection history', async () => {
  const queueBefore = (
    await db.query<Record<string, unknown>>(
      'SELECT count(*) AS n FROM family_intake_submissions'
    )
  ).rows[0].n
  const persons = (
    await db.query<Record<string, unknown>>('SELECT * FROM persons')
  ).rows
  const relationships = (
    await db.query<Record<string, unknown>>('SELECT * FROM relationships')
  ).rows
  await asRole(
    'authenticated',
    admin,
    'SELECT public.import_family_backup($1::jsonb)',
    [
      JSON.stringify({
        persons,
        relationships,
        person_details_private: [],
        custom_events: []
      })
    ]
  )
  assert.equal(
    (
      await db.query<Record<string, unknown>>(
        'SELECT count(*) AS n FROM family_intake_submissions'
      )
    ).rows[0].n,
    queueBefore
  )
  assert.equal(
    (
      await db.query<Record<string, unknown>>(
        'SELECT memorial_day FROM persons WHERE id=$1',
        [root]
      )
    ).rows[0].memorial_day,
    5
  )
  await db.query<Record<string, unknown>>('DELETE FROM persons WHERE id=$1', [
    root
  ])
  assert.equal(
    (
      await asRole(
        'anon',
        null,
        'SELECT public.get_family_intake_options($1) AS options',
        [token]
      )
    ).rows[0].options,
    null
  )
  assert.equal(
    (
      await db.query<Record<string, unknown>>(
        'SELECT count(*) AS n FROM family_intake_submissions'
      )
    ).rows[0].n,
    queueBefore
  )
})
