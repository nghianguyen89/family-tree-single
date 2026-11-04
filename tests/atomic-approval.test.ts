import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(
  'docs/migrations/20261029010000_atomic_account_approval.sql',
  'utf8'
)

test('approval transaction rolls back failures, allows retry and replay, and denies browser roles', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE profiles(id uuid PRIMARY KEY, is_active boolean NOT NULL, updated_at timestamptz);
      CREATE TABLE user_approval_requests(id uuid PRIMARY KEY, user_id uuid, email text,
        token_hash text UNIQUE, expires_at timestamptz, used_at timestamptz);
      INSERT INTO profiles VALUES ('11111111-1111-4111-8111-111111111111',false,null);
      INSERT INTO user_approval_requests VALUES ('22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111','pending@example.test',repeat('a',64),now()+interval '1 day',null);
      ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
      ALTER TABLE user_approval_requests ENABLE ROW LEVEL SECURITY;
    `)
    await db.exec(migration)
    await db.exec(migration)
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`)
      await assert.rejects(
        db.query("SELECT approve_pending_user(repeat('a',64))"),
        /permission denied/
      )
      await db.exec('RESET ROLE')
    }
    await db.exec(`
      CREATE FUNCTION fail_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'transient failure'; END $$;
      CREATE TRIGGER fail_claim BEFORE UPDATE ON user_approval_requests FOR EACH ROW EXECUTE FUNCTION fail_claim();
      SET ROLE service_role;
    `)
    await assert.rejects(
      db.query("SELECT approve_pending_user(repeat('a',64))"),
      /transient failure/
    )
    await db.exec('RESET ROLE')
    assert.deepEqual((await db.query('SELECT is_active FROM profiles')).rows, [
      { is_active: false }
    ])
    assert.deepEqual(
      (await db.query('SELECT used_at FROM user_approval_requests')).rows,
      [{ used_at: null }]
    )
    await db.exec(
      'DROP TRIGGER fail_claim ON user_approval_requests; SET ROLE service_role'
    )
    const approve = async (hash: string | null) =>
      (
        await db.query<{ result: { status: string; email?: string } }>(
          'SELECT approve_pending_user($1) AS result',
          [hash]
        )
      ).rows[0].result
    assert.deepEqual(await approve('a'.repeat(64)), {
      status: 'approved',
      email: 'pending@example.test'
    })
    assert.equal((await approve('a'.repeat(64))).status, 'processed')
    for (const hash of [null, '', 'A'.repeat(64), 'b'.repeat(64)])
      assert.equal((await approve(hash)).status, 'invalid')
    await db.exec(
      "RESET ROLE; UPDATE user_approval_requests SET used_at=null, expires_at=now()-interval '1 day'; SET ROLE service_role"
    )
    assert.equal((await approve('a'.repeat(64))).status, 'invalid')
    await db.exec(
      "RESET ROLE; UPDATE user_approval_requests SET expires_at=now()+interval '1 day'; DELETE FROM profiles; SET ROLE service_role"
    )
    assert.equal((await approve('a'.repeat(64))).status, 'not_found')
    await db.exec('RESET ROLE')
    assert.deepEqual(
      (await db.query('SELECT used_at FROM user_approval_requests')).rows,
      [{ used_at: null }]
    )
  } finally {
    await db.close()
  }
})
