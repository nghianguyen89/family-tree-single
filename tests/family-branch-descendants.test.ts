import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(
  'docs/migrations/20261019030000_family_branch_descendants.sql',
  'utf8'
)
const id = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`

test('main descendants read ancestor branches immediately while branch mutations stay with the designated couple', async () => {
  const db = new PGlite()
  const [
    admin,
    editor,
    member,
    adopted,
    spouseAccount,
    siblingAccount,
    partnerChildAccount,
    inactive
  ] = [1, 2, 3, 4, 5, 6, 7, 8].map(id)
  const [
    anchor,
    partner,
    son,
    grandson,
    adoptedSon,
    sonSpouse,
    sibling,
    partnerChild,
    outsider,
    hiddenAnchor
  ] = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map(id)
  async function as(user: string, sql: string, params: unknown[] = []) {
    return db.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE authenticated')
      await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
        user
      ])
      return tx.query<Record<string, unknown>>(sql, params)
    })
  }
  async function can(
    user: string,
    name = 'can_view_family_branch',
    branch = id(30)
  ) {
    return (await as(user, `SELECT public.${name}($1) AS allowed`, [branch]))
      .rows[0].allowed
  }
  try {
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
    await db.exec(
      readFileSync('docs/schema.sql', 'utf8').replace(
        'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;',
        ''
      )
    )
    for (const file of readdirSync('docs/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      if (file >= '20261019030000_family_branch_descendants.sql') continue
      await db.exec(readFileSync(`docs/migrations/${file}`, 'utf8'))
    }
    for (const [user, role] of [
      [admin, 'admin'],
      [editor, 'editor'],
      [member, 'member'],
      [adopted, 'member'],
      [spouseAccount, 'member'],
      [siblingAccount, 'member'],
      [partnerChildAccount, 'member'],
      [inactive, 'editor']
    ]) {
      await db.query('INSERT INTO auth.users VALUES ($1,$2,now())', [
        user,
        `${user}@example.test`
      ])
      await db.query(
        'UPDATE profiles SET role=$1::public.user_role_enum,is_active=$2 WHERE id=$3',
        [role, user !== inactive, user]
      )
    }
    for (const person of [
      anchor,
      partner,
      son,
      grandson,
      adoptedSon,
      sonSpouse,
      sibling,
      partnerChild,
      outsider,
      hiddenAnchor
    ]) {
      await db.query(
        "INSERT INTO persons(id,full_name,gender,is_in_law) VALUES ($1,'Synthetic person','female',$2)",
        [person, [anchor, hiddenAnchor].includes(person)]
      )
    }
    for (const [user, person] of [
      [admin, anchor],
      [editor, son],
      [member, grandson],
      [adopted, adoptedSon],
      [spouseAccount, sonSpouse],
      [siblingAccount, sibling],
      [partnerChildAccount, partnerChild]
    ]) {
      await db.query('UPDATE profiles SET person_id=$1 WHERE id=$2', [
        person,
        user
      ])
    }
    for (const [a, b, type] of [
      [anchor, partner, 'marriage'],
      [anchor, son, 'biological_child'],
      [son, grandson, 'biological_child'],
      [anchor, adoptedSon, 'adopted_child'],
      [son, sonSpouse, 'marriage'],
      [partner, partnerChild, 'biological_child']
    ]) {
      await db.query(
        'INSERT INTO relationships(person_a,person_b,type) VALUES ($1,$2,$3::public.relationship_type_enum)',
        [a, b, type]
      )
    }
    await db.query(
      'INSERT INTO family_branches(id,name,anchor_person_id,root_person_id) VALUES ($1,$2,$3,$3),($4,$5,$6,$6)',
      [
        id(30),
        'Visible ancestor branch',
        anchor,
        id(31),
        'Hidden owner branch',
        hiddenAnchor
      ]
    )
    for (const [person, branch] of [
      [id(40), id(30)],
      [id(41), id(31)]
    ]) {
      await db.query(
        "INSERT INTO persons(id,full_name,gender,family_branch_id,is_deceased,memorial_day,memorial_month,memorial_calendar,avatar_url) VALUES ($1,'Synthetic ancestor','male',$2,true,5,3,'lunar',$3)",
        [person, branch, `${person}.webp`]
      )
      await db.query("INSERT INTO storage.objects VALUES ($1,'avatars',$2)", [
        person,
        `${person}.webp`
      ])
    }
    await db.query(
      "INSERT INTO relationships(id,person_a,person_b,type,family_branch_id) VALUES ($1,$2,$3,'biological_child',$4)",
      [id(50), id(40), anchor, id(30)]
    )
    assert.equal(await can(editor), false)
    const before = (
      await db.query(
        'SELECT to_jsonb(b) AS data FROM family_branches b ORDER BY id'
      )
    ).rows
    await db.exec(migration)
    await db.exec(migration)
    assert.deepEqual(
      (
        await db.query(
          'SELECT to_jsonb(b) AS data FROM family_branches b ORDER BY id'
        )
      ).rows,
      before
    )
    for (const user of [editor, member, adopted]) {
      assert.equal(await can(user), true)
      assert.equal(await can(user, 'can_edit_family_branch'), false)
      assert.equal(
        (
          await as(
            user,
            'SELECT * FROM family_branch_members WHERE branch_id=$1',
            [id(30)]
          )
        ).rows.length,
        2
      )
      assert.equal(
        (
          await as(user, 'SELECT memorial_day FROM persons WHERE id=$1', [
            id(40)
          ])
        ).rows[0].memorial_day,
        5
      )
      assert.equal(
        (await as(user, 'SELECT * FROM relationships WHERE id=$1', [id(50)]))
          .rows.length,
        1
      )
      assert.equal(
        (
          await as(
            user,
            "SELECT * FROM storage.objects WHERE bucket_id='avatars' AND name=$1",
            [`${id(40)}.webp`]
          )
        ).rows.length,
        1
      )
    }
    for (const user of [
      spouseAccount,
      siblingAccount,
      partnerChildAccount,
      inactive
    ])
      assert.equal(await can(user), false)
    // Branch-local ancestry never grants access, even for a main-lineage profile.
    await db.query(
      'INSERT INTO family_branch_members(branch_id,person_id) VALUES ($1,$2)',
      [id(30), sibling]
    )
    await db.query(
      "INSERT INTO relationships(person_a,person_b,type,family_branch_id) VALUES ($1,$2,'biological_child',$3)",
      [anchor, sibling, id(30)]
    )
    assert.equal(await can(siblingAccount), false)
    // Shared ownership permits reading, but does not turn that membership into editing.
    await db.query(
      'INSERT INTO family_branch_members(branch_id,person_id) VALUES ($1,$2)',
      [id(30), id(41)]
    )
    assert.equal(
      (await as(editor, 'SELECT * FROM persons WHERE id=$1', [id(41)])).rows
        .length,
      1
    )
    assert.equal(await can(editor, 'can_view_family_branch', id(31)), false)
    for (const person of [id(40), id(41)]) {
      assert.equal(
        (
          await as(editor, 'SELECT public.can_edit_person($1) AS allowed', [
            person
          ])
        ).rows[0].allowed,
        false
      )
      assert.equal(
        (
          await as(
            editor,
            "UPDATE persons SET note='Forged' WHERE id=$1 RETURNING id",
            [person]
          )
        ).rows.length,
        0
      )
      assert.equal(
        (
          await as(editor, 'DELETE FROM persons WHERE id=$1 RETURNING id', [
            person
          ])
        ).rows.length,
        0
      )
      assert.equal(
        (
          await as(
            editor,
            'DELETE FROM storage.objects WHERE name=$1 RETURNING id',
            [`${person}.webp`]
          )
        ).rows.length,
        0
      )
      await assert.rejects(() =>
        as(editor, "INSERT INTO storage.objects VALUES ($1,'avatars',$2)", [
          id(70),
          `${person}_new.webp`
        ])
      )
      await assert.rejects(() =>
        as(editor, 'UPDATE persons SET avatar_url=$1 WHERE id=$2', [
          `${person}.webp`,
          son
        ])
      )
    }
    await db.query(
      "UPDATE persons SET avatar_url='historical-ancestor.webp' WHERE id=$1",
      [id(40)]
    )
    await db.query(
      "INSERT INTO storage.objects VALUES ($1,'avatars','historical-ancestor.webp')",
      [id(71)]
    )
    assert.equal(
      (
        await as(
          editor,
          "SELECT * FROM storage.objects WHERE name='historical-ancestor.webp'"
        )
      ).rows.length,
      1
    )
    assert.equal(
      (
        await as(
          editor,
          "DELETE FROM storage.objects WHERE name='historical-ancestor.webp' RETURNING id"
        )
      ).rows.length,
      0
    )
    for (const sql of [
      "UPDATE family_branches SET name='Forged' WHERE id=$1 RETURNING id",
      'DELETE FROM family_branches WHERE id=$1 RETURNING id',
      'UPDATE family_branch_members SET generation=9 WHERE branch_id=$1 RETURNING person_id',
      'DELETE FROM family_branch_members WHERE branch_id=$1 RETURNING person_id',
      "UPDATE relationships SET type='adopted_child' WHERE family_branch_id=$1 RETURNING id",
      'DELETE FROM relationships WHERE family_branch_id=$1 RETURNING id'
    ])
      assert.equal((await as(editor, sql, [id(30)])).rows.length, 0)
    await assert.rejects(() =>
      as(editor, 'SELECT public.add_family_branch_person($1,$2::jsonb)', [
        id(30),
        JSON.stringify({ full_name: 'Forged', gender: 'male' })
      ])
    )
    await assert.rejects(() =>
      as(
        editor,
        "INSERT INTO persons(full_name,gender,family_branch_id) VALUES ('Forged','male',$1)",
        [id(30)]
      )
    )
    await assert.rejects(() =>
      as(editor, 'INSERT INTO family_branch_members VALUES ($1,$2,NULL)', [
        id(30),
        outsider
      ])
    )
    await assert.rejects(() =>
      as(
        editor,
        "INSERT INTO relationships(type,person_a,person_b,family_branch_id) VALUES ('marriage',$1,$2,$3)",
        [anchor, id(40), id(30)]
      )
    )
    assert.equal(
      (
        await as(
          editor,
          "UPDATE persons SET note='Main edit allowed' WHERE id=$1 RETURNING id",
          [son]
        )
      ).rows.length,
      1
    )
    await db.query('UPDATE profiles SET person_id=$1 WHERE id=$2', [
      partner,
      editor
    ])
    assert.equal(await can(editor, 'can_edit_family_branch'), true)
    await db.query('UPDATE profiles SET person_id=$1 WHERE id=$2', [
      son,
      editor
    ])
    // A descendant who edits another branch cannot manufacture an editable
    // membership for an ancestor they are only permitted to read.
    await db.query('UPDATE persons SET is_in_law=true WHERE id=$1', [sonSpouse])
    await db.query(
      'INSERT INTO family_branches(id,name,anchor_person_id,root_person_id) VALUES ($1,$2,$3,$3)',
      [id(32), 'Descendant couple branch', sonSpouse]
    )
    assert.equal(await can(editor, 'can_edit_family_branch', id(32)), true)
    await assert.rejects(() =>
      as(
        editor,
        'INSERT INTO family_branch_members(branch_id,person_id) VALUES ($1,$2)',
        [id(32), id(40)]
      )
    )
    await as(
      editor,
      'INSERT INTO family_branch_members(branch_id,person_id) VALUES ($1,$2)',
      [id(32), outsider]
    )
    await assert.rejects(() =>
      as(
        editor,
        'UPDATE family_branch_members SET person_id=$1 WHERE branch_id=$2 AND person_id=$3',
        [id(40), id(32), outsider]
      )
    )
    await assert.rejects(() =>
      as(
        editor,
        "SELECT public.add_family_branch_person($1,'{}'::jsonb,NULL,'member',$2)",
        [id(32), id(40)]
      )
    )
    assert.equal(
      (
        await db.query(
          'SELECT * FROM family_branch_members WHERE branch_id=$1 AND person_id=$2',
          [id(32), id(40)]
        )
      ).rows.length,
      0
    )
    assert.equal(
      (
        await as(editor, 'SELECT public.can_edit_person($1) AS allowed', [
          id(40)
        ])
      ).rows[0].allowed,
      false
    )
    await assert.rejects(() =>
      as(editor, "INSERT INTO storage.objects VALUES ($1,'avatars',$2)", [
        id(72),
        `${id(40)}_forged.webp`
      ])
    )
    // Admin-confirmed sharing still enables the existing shared-profile edits.
    await db.query(
      'INSERT INTO family_branch_members(branch_id,person_id) VALUES ($1,$2)',
      [id(32), id(40)]
    )
    assert.equal(
      (
        await as(editor, 'SELECT public.can_edit_person($1) AS allowed', [
          id(40)
        ])
      ).rows[0].allowed,
      true
    )
    await db.query(
      'DELETE FROM family_branch_members WHERE branch_id=$1 AND person_id=$2',
      [id(32), id(40)]
    )
    // Identity/activity and ancestry revocations take effect without stale grants.
    await db.query('UPDATE profiles SET is_active=false WHERE id=$1', [editor])
    assert.equal(await can(editor), false)
    await db.query(
      'UPDATE profiles SET is_active=true,person_id=NULL WHERE id=$1',
      [editor]
    )
    assert.equal(await can(editor), false)
    await db.query('UPDATE profiles SET person_id=$1 WHERE id=$2', [
      son,
      editor
    ])
    assert.equal(await can(editor), true)
    await db.query(
      'DELETE FROM relationships WHERE person_a=$1 AND person_b=$2 AND family_branch_id IS NULL',
      [anchor, son]
    )
    assert.equal(await can(editor), false)
    assert.equal(await can(member), false)
    assert.equal(await can(adopted), true)
    // UNION, rather than UNION ALL, terminates even if legacy main data has a cycle.
    await db.query(
      "INSERT INTO relationships(person_a,person_b,type) VALUES ($1,$2,'biological_child'),($2,$1,'biological_child')",
      [anchor, son]
    )
    assert.equal(await can(editor), true)
    assert.equal(await can(member), true)
    // The designated anchor still edits when that account has the editor role.
    await db.query("UPDATE profiles SET role='editor' WHERE id=$1", [admin])
    assert.equal(await can(admin, 'can_edit_family_branch'), true)
    assert.equal(
      (
        await as(
          admin,
          "UPDATE persons SET note='Couple edit allowed' WHERE id=$1 RETURNING id",
          [id(40)]
        )
      ).rows.length,
      1
    )
  } finally {
    await db.close()
  }
})
