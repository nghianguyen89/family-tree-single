'use server'

import { promises as fs } from 'node:fs'
import path from 'node:path'

import postgres from 'postgres'

import { getServerTranslations } from '@/lib/i18n/server'
import packageJson from '@/package.json'
import { assertDatabaseTarget } from '@/utils/deployment'
import {
  evaluateReleases,
  isSchemaCompatible,
  parseReleaseManifest,
  PRODUCT_UPDATE_GUIDE,
  type SourceVersionStatus
} from '@/utils/releases'
import { getIsAdmin } from '@/utils/supabase/queries'

const MIGRATION_FILES = [
  'docs/schema.sql',
  'docs/migrations/20260312015736_add_lunar_death_date.sql',
  'docs/migrations/20260320230020_add_editor_permission.sql',
  'docs/migrations/20260524125731_add_gallery.sql',
  'docs/migrations/20260831140135_security_and_approval_hardening.sql',
  'docs/migrations/20260901000000_security_definer_and_rls_hardening.sql',
  'docs/migrations/20260904000000_add_data_api_table_grants.sql',
  'docs/migrations/20261014000000_personal_fork_security.sql',
  'docs/migrations/20261014010000_add_person_year_ranges.sql',
  'docs/migrations/20261014020000_family_intake_and_memorial.sql',
  'docs/migrations/20261015000000_home_content.sql',
  'docs/migrations/20261015010000_shared_media_library.sql',
  'docs/migrations/20261016000000_intake_link_management.sql',
  'docs/migrations/20261016010000_fix_media_insert_returning.sql',
  'docs/migrations/20261019000000_family_branches.sql',
  'docs/migrations/20261019010000_family_branch_privacy.sql',
  'docs/migrations/20261019020000_home_origin_previous.sql',
  'docs/migrations/20261019030000_family_branch_descendants.sql',
  'docs/migrations/20261029000000_family_data_integrity.sql',
  'docs/migrations/20261029010000_atomic_account_approval.sql',
  'docs/migrations/20261029020000_access_invariants.sql',
  'docs/migrations/20261102000000_intake_submission_delete.sql',
  'docs/migrations/20261102010000_shared_viewer.sql'
] as const

const MIGRATION_TABLE = 'public.app_migrations'

interface MigrationDefinition {
  id: string
  file: string
  sql: string
}

export interface MigrationStatus {
  configured: boolean
  databaseReachable: boolean
  error?: string
  source: SourceVersionStatus
  schemaVersion: string
  schemaCompatible: boolean
  migrations: Array<{
    id: string
    file: string
    appliedAt: string | null
  }>
}

export async function getSourceVersionStatus(): Promise<SourceVersionStatus> {
  const { t } = await getServerTranslations()
  const unknown = (error: string): SourceVersionStatus => ({
    state: 'unknown',
    currentVersion: packageJson.version,
    latestVersion: null,
    readmeUrl: PRODUCT_UPDATE_GUIDE,
    error
  })
  if (!(await getIsAdmin())) return unknown(t('migrationAccessDenied'))
  // Explicit operator-selected publication feed; development commits are not releases.
  const feed = process.env.PRODUCT_RELEASE_MANIFEST_URL?.trim()
  if (!feed) return unknown(t('releaseFeedMissing'))
  try {
    const url = new URL(feed)
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Invalid release feed URL.')
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000)
    })
    if (!response.ok) throw new Error('Release feed unavailable.')
    const body = await response.text()
    if (body.length > 256000)
      throw new Error('Release feed exceeds size limit.')
    return evaluateReleases(
      packageJson.version,
      parseReleaseManifest(JSON.parse(body))
    )
  } catch {
    return unknown(t('sourceVersionFetchError'))
  }
}

async function getMigrationDefinitions(): Promise<MigrationDefinition[]> {
  return Promise.all(
    MIGRATION_FILES.map(async (file) => ({
      id: file,
      file,
      // SQL Editor files carry their own transaction wrappers. The runner owns
      // one transaction for the whole batch, so they must not commit it early.
      sql: (
        await fs.readFile(
          file === 'docs/schema.sql'
            ? path.join(process.cwd(), 'docs', 'schema.sql')
            : path.join(
                process.cwd(),
                'docs',
                'migrations',
                path.basename(file)
              ),
          'utf8'
        )
      ).replace(/^(?:BEGIN|COMMIT);[ \t]*\r?$/gm, '')
    }))
  )
}

function createDatabaseClient() {
  const databaseUrl = process.env.SUPABASE_DB_URL?.trim()
  if (!databaseUrl) return null

  assertDatabaseTarget(databaseUrl)

  return postgres(databaseUrl, {
    ssl: 'require',
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false
  })
}

export async function getMigrationStatus(): Promise<MigrationStatus> {
  const { t } = await getServerTranslations()
  const isAdmin = await getIsAdmin()
  const definitions = await getMigrationDefinitions()

  if (!isAdmin) {
    return {
      configured: Boolean(process.env.SUPABASE_DB_URL),
      databaseReachable: false,
      error: t('migrationAccessDenied'),
      schemaVersion: MIGRATION_FILES[MIGRATION_FILES.length - 1],
      schemaCompatible: false,
      source: {
        state: 'unknown',
        currentVersion: null,
        latestVersion: null,
        readmeUrl: PRODUCT_UPDATE_GUIDE
      },
      migrations: definitions.map(({ id, file }) => ({
        id,
        file,
        appliedAt: null
      }))
    }
  }

  const source = await getSourceVersionStatus()

  let sql: ReturnType<typeof postgres> | null = null
  try {
    sql = createDatabaseClient()
  } catch {
    return {
      configured: true,
      databaseReachable: false,
      source,
      schemaVersion: MIGRATION_FILES[MIGRATION_FILES.length - 1],
      schemaCompatible: false,
      error: t('migrationTargetError'),
      migrations: definitions.map(({ id, file }) => ({
        id,
        file,
        appliedAt: null
      }))
    }
  }
  if (!sql) {
    return {
      configured: false,
      databaseReachable: false,
      error: t('databaseConfigMissing'),
      source,
      schemaVersion: MIGRATION_FILES[MIGRATION_FILES.length - 1],
      schemaCompatible: false,
      migrations: definitions.map(({ id, file }) => ({
        id,
        file,
        appliedAt: null
      }))
    }
  }

  try {
    const [tracking] = await sql<
      { exists: boolean }[]
    >`SELECT to_regclass('public.app_migrations') IS NOT NULL AS exists`
    const rows = tracking.exists
      ? await sql.unsafe<
          Array<{
            migration_id: string
            applied_at: string
          }>
        >(
          `SELECT migration_id, applied_at FROM ${MIGRATION_TABLE} ORDER BY applied_at ASC`
        )
      : []
    const applied = new Map(
      rows.map((row) => [
        row.migration_id,
        new Date(row.applied_at).toISOString()
      ])
    )

    return {
      configured: true,
      databaseReachable: true,
      source,
      schemaVersion: MIGRATION_FILES[MIGRATION_FILES.length - 1],
      schemaCompatible: isSchemaCompatible(
        [...applied.keys()],
        MIGRATION_FILES
      ),
      ...(!isSchemaCompatible([...applied.keys()], MIGRATION_FILES)
        ? { error: t('schemaIncompatible') }
        : {}),
      migrations: definitions.map((migration) => ({
        id: migration.id,
        file: migration.file,
        appliedAt: applied.get(migration.id) || null
      }))
    }
  } catch (error) {
    console.error('Cannot inspect migration status:', error)
    return {
      configured: true,
      databaseReachable: false,
      error: t(
        error instanceof Error && 'code' in error && error.code === '28P01'
          ? 'databaseAuthenticationError'
          : 'migrationStatusError'
      ),
      source,
      schemaVersion: MIGRATION_FILES[MIGRATION_FILES.length - 1],
      schemaCompatible: false,
      migrations: definitions.map(({ id, file }) => ({
        id,
        file,
        appliedAt: null
      }))
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export async function runPendingMigrations() {
  const { t } = await getServerTranslations()
  const isAdmin = await getIsAdmin()
  if (!isAdmin) return { success: false, error: t('migrationAccessDenied') }

  let sql: ReturnType<typeof postgres> | null = null
  try {
    sql = createDatabaseClient()
  } catch {
    return { success: false, error: t('migrationTargetError') }
  }
  if (!sql) return { success: false, error: t('databaseConfigMissing') }

  try {
    const definitions = await getMigrationDefinitions()
    const result = await sql.begin(async (transaction) => {
      await transaction.unsafe(`
        CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
          migration_id TEXT PRIMARY KEY,
          file_name TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        ALTER TABLE ${MIGRATION_TABLE} ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON ${MIGRATION_TABLE} FROM PUBLIC, anon, authenticated;
        DROP POLICY IF EXISTS "No client access to app migrations" ON ${MIGRATION_TABLE};
        CREATE POLICY "No client access to app migrations"
          ON ${MIGRATION_TABLE}
          FOR ALL TO anon, authenticated
          USING (false)
          WITH CHECK (false);
        SELECT pg_advisory_xact_lock(hashtext('giapha_os_app_migrations'));
      `)

      const rows = await transaction.unsafe<
        Array<{ migration_id: string; applied_at: string }>
      >(`SELECT migration_id, applied_at FROM ${MIGRATION_TABLE}`)
      const applied = new Map(
        rows.map((row) => [row.migration_id, row.applied_at])
      )
      if (!isSchemaCompatible([...applied.keys()], MIGRATION_FILES)) {
        throw new Error('SCHEMA_INCOMPATIBLE')
      }
      const appliedNow: string[] = []

      for (const migration of definitions) {
        if (applied.has(migration.id)) continue

        try {
          await transaction.unsafe(migration.sql)
          await transaction`
            INSERT INTO public.app_migrations (migration_id, file_name)
            VALUES (${migration.id}, ${migration.file})
            ON CONFLICT (migration_id) DO NOTHING
          `
          appliedNow.push(migration.file)
        } catch (error) {
          console.error(`Migration failed: ${migration.file}`, error)
          throw new Error(`Migration failed: ${migration.file}`)
        }
      }

      return appliedNow
    })

    return {
      success: true,
      applied: result,
      message: result.length
        ? t('migrationsApplied', { count: result.length })
        : t('databaseAlreadyCurrent')
    }
  } catch (error) {
    console.error('Cannot run pending migrations:', error)
    return {
      success: false,
      error:
        error instanceof Error && error.message === 'SCHEMA_INCOMPATIBLE'
          ? t('schemaIncompatible')
          : error instanceof Error &&
              error.message.startsWith('Migration failed:')
            ? t('migrationFailed', {
                file: error.message.replace('Migration failed: ', '')
              })
            : t('migrationRunError')
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}
