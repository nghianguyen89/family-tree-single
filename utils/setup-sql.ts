export function buildSetupSqlBundle(
  migrations: Array<{ file: string; sql: string }>
): string {
  return [
    '-- FAMILY TREE: schema + all migrations and migration history',
    '-- Run this entire script once in Supabase SQL Editor.',
    'BEGIN;',
    "SELECT pg_advisory_xact_lock(hashtext('giapha_os_app_migrations'));",
    `CREATE TABLE IF NOT EXISTS public.app_migrations (
      migration_id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE public.app_migrations ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.app_migrations FROM PUBLIC, anon, authenticated;
    DROP POLICY IF EXISTS "No client access to app migrations" ON public.app_migrations;
    CREATE POLICY "No client access to app migrations" ON public.app_migrations
      FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);`,
    ...migrations.flatMap(({ file, sql }) => {
      if (!/^docs\/(?:schema|migrations\/[a-z0-9_]+)\.sql$/.test(file)) {
        throw new Error('Invalid setup migration path.')
      }
      return [
        `-- ${file}`,
        sql.replace(/^(?:BEGIN|COMMIT);[ \t]*\r?$/gm, ''),
        `INSERT INTO public.app_migrations (migration_id, file_name)
         VALUES ('${file}', '${file}') ON CONFLICT (migration_id) DO NOTHING;`
      ]
    }),
    // Earlier migrations grant permissions to all public tables.
    'REVOKE ALL ON public.app_migrations FROM PUBLIC, anon, authenticated;',
    'COMMIT;'
  ].join('\n')
}
