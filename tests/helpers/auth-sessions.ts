import type { PGlite } from '@electric-sql/pglite'

// Existing fixtures set the subject GUC; model the session GoTrue issues with it.
// Explicit request.jwt.claims overrides let security tests model revoked/bad JWTs.
export async function installAuthSessions(db: PGlite) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS auth.sessions (
      id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE
    );
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,
        jsonb_build_object('sub',auth.uid(),'session_id',auth.uid()));
    $$;
    GRANT EXECUTE ON FUNCTION auth.jwt() TO anon,authenticated;
    CREATE OR REPLACE FUNCTION auth.create_test_session() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO auth.sessions(id,user_id) VALUES (NEW.id,NEW.id) ON CONFLICT DO NOTHING;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER create_test_session AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION auth.create_test_session();
    INSERT INTO auth.sessions(id,user_id) SELECT id,id FROM auth.users ON CONFLICT DO NOTHING;
  `)
}
