import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'

import packageJson from '@/package.json'
import { assertDatabaseTarget, getDeploymentConfig } from '@/utils/deployment'
import {
  validateDatabaseBinding,
  validateKeyProject
} from '@/utils/family-config'

import {
  backupDigest,
  decodeWebsiteBackup,
  encodeWebsiteBackup,
  MAX_BACKUP_BYTES,
  type DecodedBackup,
  type WebsiteBackup
} from './full-backup-archive'
import {
  applyAdminAccountMapping,
  assertExclusiveRestoreOperator,
  assertMatchingSchema,
  assertNoAccountCollisions,
  assertOrdinaryAuth,
  BACKUP_BUCKETS,
  BACKUP_TABLES,
  getAdminAccountMapping,
  readBackupRows,
  readBackupSchema,
  referencedBackupPaths,
  relocateBackup,
  restoreWebsiteRows,
  stripAuthTokens,
  targetFingerprint,
  validateWebsiteData,
  type AdminAccountMapping,
  type BackupDatabase
} from './full-backup-data'

type Sql = ReturnType<typeof postgres>
export const databaseAdapter = (
  sql: Sql | postgres.TransactionSql
): BackupDatabase => ({
  query: async (text, values = []) =>
    Array.from(
      await sql.unsafe(text, values as postgres.ParameterOrJSON<never>[])
    )
})

export function fullBackupAvailability() {
  const config = getDeploymentConfig()
  return {
    enabled:
      process.env.WEBSITE_BACKUP_ENABLED === 'true' && !process.env.VERCEL,
    targetProjectRef: config.supabaseProjectRef,
    targetFamily: config.siteName,
    isDemo: config.isDemo,
    sqlConfigured: Boolean(process.env.SUPABASE_DB_URL),
    storageConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    operatorConfigured: Boolean(process.env.WEBSITE_BACKUP_OPERATOR_ID),
    externalSourceConfigured: [
      'PROJECT_REF',
      'DB_URL',
      'SERVICE_ROLE_KEY'
    ].every((k) => Boolean(process.env[`WEBSITE_BACKUP_SOURCE_${k}`])),
    maxBytes: MAX_BACKUP_BYTES,
    explanation: process.env.VERCEL
      ? 'Sao lưu toàn website chạy trên local hoặc máy chủ riêng để tránh giới hạn upload/thời gian của Vercel.'
      : 'Bật WEBSITE_BACKUP_ENABLED=true trên môi trường vận hành để sử dụng.'
  }
}

export function assertBackupOperator(id: string) {
  if (
    !process.env.WEBSITE_BACKUP_OPERATOR_ID ||
    id !== process.env.WEBSITE_BACKUP_OPERATOR_ID
  )
    throw new Error(
      'Tài khoản này chưa được chỉ định làm người vận hành backup. Cấu hình WEBSITE_BACKUP_OPERATOR_ID trên server.'
    )
}

function connection(external = false) {
  const target = getDeploymentConfig()
  const prefix = external ? 'WEBSITE_BACKUP_SOURCE_' : 'SUPABASE_'
  const ref = external
    ? process.env.WEBSITE_BACKUP_SOURCE_PROJECT_REF
    : target.supabaseProjectRef
  const url = external
    ? `https://${ref}.supabase.co`
    : process.env.NEXT_PUBLIC_SUPABASE_URL
  const dbUrl = process.env[`${prefix}DB_URL`]
  const key = process.env[`${prefix}SERVICE_ROLE_KEY`]
  if (!ref || !/^[a-z0-9]{20}$/.test(ref) || !url || !dbUrl || !key)
    throw new Error('Thiếu cấu hình SQL hoặc service-role cho project đã chọn.')
  validateDatabaseBinding(dbUrl, ref)
  if (!external) assertDatabaseTarget(dbUrl)
  validateKeyProject(key, ref, 'service_role')
  const sql = postgres(dbUrl, {
    ssl: 'require',
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false
  })
  const storage = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(30000) })
    }
  })
  return { ref, sql, storage }
}

export function requireFullBackupEnabled() {
  const status = fullBackupAvailability()
  if (!status.enabled)
    throw new Error(
      'Chưa bật sao lưu toàn website. Chạy local/máy chủ riêng và đặt WEBSITE_BACKUP_ENABLED=true.'
    )
  if (!status.sqlConfigured || !status.storageConfigured)
    throw new Error(
      'Thiếu SUPABASE_DB_URL hoặc SUPABASE_SERVICE_ROLE_KEY ở nơi nhận.'
    )
}

async function inventory(db: BackupDatabase) {
  const rows = await db.query(
    'SELECT bucket_id,name,metadata,updated_at FROM storage.objects WHERE bucket_id=ANY($1::text[]) ORDER BY bucket_id,name',
    [[...BACKUP_BUCKETS]]
  )
  return rows
}
const inventoryDigest = (rows: Awaited<ReturnType<typeof inventory>>) =>
  createHash('sha256').update(JSON.stringify(rows)).digest('hex')

async function assertPrivateBuckets(
  storage: SupabaseClient,
  files: WebsiteBackup['files'] = []
) {
  const { data, error } = await storage.storage.listBuckets()
  if (
    error ||
    !BACKUP_BUCKETS.every((name) =>
      data.some((b) => b.id === name && !b.public)
    )
  )
    throw new Error(
      'Cấu hình bốn bucket ảnh private chưa đầy đủ. Chưa thay đổi dữ liệu.'
    )
  for (const file of files) {
    const bucket = data.find((b) => b.id === file.bucket)!
    if (bucket.file_size_limit != null && file.size > bucket.file_size_limit)
      throw new Error(
        'File ảnh vượt giới hạn dung lượng bucket nơi nhận. Chưa thay đổi dữ liệu.'
      )
    if (
      bucket.allowed_mime_types &&
      !bucket.allowed_mime_types.some(
        (mime) =>
          mime === file.mime ||
          mime === '*/*' ||
          mime === `${file.mime.split('/')[0]}/*`
      )
    )
      throw new Error(
        'File ảnh có định dạng bucket nơi nhận không cho phép. Chưa thay đổi dữ liệu.'
      )
  }
}

export async function exportWebsiteBackup(password: string, external: boolean) {
  requireFullBackupEnabled()
  const { sql, storage, ref } = connection(external)
  try {
    await assertPrivateBuckets(storage)
    const result = await sql.begin(
      'isolation level repeatable read read only',
      async (tx) => {
        const db = databaseAdapter(tx)
        await db.query("SET LOCAL statement_timeout='30000'")
        await assertOrdinaryAuth(db)
        const schema = await readBackupSchema(db)
        const tables = await readBackupRows(db, schema)
        stripAuthTokens(tables)
        const objects = await inventory(db)
        const manifest: WebsiteBackup = {
          format: 1,
          createdAt: new Date().toISOString(),
          appVersion: packageJson.version,
          sourceProjectRef: ref,
          schema,
          tables,
          files: []
        }
        validateWebsiteData(manifest)
        // Retained recovery files and interrupted uploads are not live website
        // data. Including them would grow archives after every restore.
        const referenced = referencedBackupPaths(manifest)
        const liveObjects = objects.filter((object) =>
          referenced.has(`${object.bucket_id}/${object.name}`)
        )
        if (liveObjects.length > 10000)
          throw new Error('Dữ liệu vượt giới hạn 10.000 file mỗi bản sao lưu.')
        const files: Buffer[] = []
        let total = Buffer.byteLength(JSON.stringify(manifest))
        for (const object of liveObjects) {
          const metadata = object.metadata as {
            size?: number
            mimetype?: string
          } | null
          if (
            !metadata ||
            !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(
              metadata.mimetype || ''
            )
          )
            throw new Error(
              'File Storage có định dạng ngoài phạm vi ảnh JPEG/PNG/WebP/GIF; không tạo bản sao lưu thiếu file.'
            )
          total += Number(metadata.size) || 0
          if (total > MAX_BACKUP_BYTES)
            throw new Error('Dữ liệu vượt giới hạn 128 MiB mỗi bản sao lưu.')
          const { data, error } = await storage.storage
            .from(String(object.bucket_id))
            .download(String(object.name))
          if (error || !data)
            throw new Error(
              'File ảnh nguồn không tải được. Hãy tạm dừng cập nhật nguồn rồi thử lại.'
            )
          const bytes = Buffer.from(await data.arrayBuffer())
          if (bytes.length !== Number(metadata.size))
            throw new Error(
              'File ảnh nguồn đã thay đổi trong lúc sao lưu. Hãy thử lại khi nguồn ngừng cập nhật.'
            )
          files.push(bytes)
          manifest.files.push({
            bucket: String(object.bucket_id),
            path: String(object.name),
            size: bytes.length,
            mime: metadata.mimetype!,
            sha256: createHash('sha256').update(bytes).digest('hex')
          })
        }
        // A complete archive must also contain every referenced image, not merely
        // whatever the Storage inventory happened to return.
        relocateBackup(manifest)
        return { manifest, files, inventoryHash: inventoryDigest(objects) }
      }
    )
    if (
      inventoryDigest(await inventory(databaseAdapter(sql))) !==
      result.inventoryHash
    )
      throw new Error(
        'File ảnh nguồn đã thay đổi trong lúc sao lưu. Hãy thử lại khi nguồn ngừng cập nhật.'
      )
    return encodeWebsiteBackup(result.manifest, result.files, password)
  } finally {
    await sql.end()
  }
}

function tokenKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Thiếu khóa server cho bước xác nhận khôi phục.')
  return key
}
export function signRestorePreview(payload: {
  digest: string
  target: string
  actor: string
  fingerprint: string
  expires: number
  adminMapping?: AdminAccountMapping | null
}) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${createHmac('sha256', tokenKey()).update(body).digest('base64url')}`
}
function readRestorePreview(
  token: string,
  digest: string,
  actor: string,
  target: string
) {
  const [body, mac, ...rest] = token.split('.')
  if (!body || !mac || rest.length || token.length > 2000)
    throw new Error(
      'Bản xem trước không hợp lệ hoặc đã hết hạn. Kiểm tra file lại.'
    )
  const expected = createHmac('sha256', tokenKey()).update(body).digest()
  const received = Buffer.from(mac, 'base64url')
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    throw new Error(
      'Bản xem trước không hợp lệ hoặc đã hết hạn. Kiểm tra file lại.'
    )
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
  if (
    payload.digest !== digest ||
    payload.actor !== actor ||
    payload.target !== target ||
    typeof payload.fingerprint !== 'string' ||
    payload.expires < Date.now()
  )
    throw new Error(
      'Bản xem trước không hợp lệ hoặc đã hết hạn. Kiểm tra file lại.'
    )
  return payload as {
    fingerprint: string
    adminMapping?: AdminAccountMapping | null
  }
}

async function inspectDecoded(
  db: BackupDatabase,
  decoded: DecodedBackup,
  actor: string
) {
  const config = getDeploymentConfig()
  const { manifest } = decoded
  if (config.isDemo && manifest.sourceProjectRef !== config.supabaseProjectRef)
    throw new Error(
      'Không khôi phục dữ liệu của project khác vào Demo. Chọn đúng gia tộc nhận dữ liệu thật.'
    )
  validateWebsiteData(manifest)
  assertMatchingSchema(manifest.schema, await readBackupSchema(db))
  await assertOrdinaryAuth(db)
  const adminMapping =
    manifest.sourceProjectRef !== config.supabaseProjectRef
      ? await getAdminAccountMapping(db, manifest, actor)
      : null
  await assertNoAccountCollisions(
    db,
    adminMapping ? applyAdminAccountMapping(manifest, adminMapping) : manifest
  )
  relocateBackup(manifest)
  return adminMapping
}

export async function inspectWebsiteBackup(
  bytes: Uint8Array,
  password: string,
  actor: string
) {
  requireFullBackupEnabled()
  assertBackupOperator(actor)
  const decoded = await decodeWebsiteBackup(bytes, password)
  const { sql, storage, ref } = connection()
  try {
    await assertPrivateBuckets(storage, decoded.manifest.files)
    const { fingerprint, adminMapping } = await sql.begin(
      'isolation level repeatable read read only',
      async (tx) => {
        const db = databaseAdapter(tx)
        await assertExclusiveRestoreOperator(db, actor)
        const adminMapping = await inspectDecoded(db, decoded, actor)
        return { fingerprint: await targetFingerprint(db), adminMapping }
      }
    )
    return {
      createdAt: decoded.manifest.createdAt,
      sourceProjectRef: decoded.manifest.sourceProjectRef,
      targetProjectRef: ref,
      counts: Object.fromEntries(
        BACKUP_TABLES.map((t) => [t, decoded.manifest.tables[t].length])
      ),
      fileCount: decoded.files.length,
      fileBytes: decoded.files.reduce((n, f) => n + f.length, 0),
      confirmation: `RESTORE ${ref}`,
      adminMapping,
      token: signRestorePreview({
        digest: backupDigest(bytes),
        target: ref,
        actor,
        fingerprint,
        adminMapping,
        expires: Date.now() + 10 * 60 * 1000
      })
    }
  } finally {
    await sql.end()
  }
}

export async function restoreWebsiteBackup(
  bytes: Uint8Array,
  password: string,
  actor: string,
  token: string,
  confirmation: string,
  acceptAdminMapping = false
) {
  requireFullBackupEnabled()
  assertBackupOperator(actor)
  const config = getDeploymentConfig()
  if (confirmation !== `RESTORE ${config.supabaseProjectRef}`)
    throw new Error('Vui lòng nhập chính xác dòng xác nhận project đích.')
  const preview = readRestorePreview(
    token,
    backupDigest(bytes),
    actor,
    config.supabaseProjectRef
  )
  if (preview.adminMapping && !acceptAdminMapping)
    throw new Error(
      'Vui lòng đồng ý ánh xạ admin nguồn sang admin đích trước khi khôi phục.'
    )
  const decoded = await decodeWebsiteBackup(bytes, password)
  const { sql, storage } = connection()
  const uploaded: Array<{ bucket: string; path: string }> = []
  let committed = false
  let callbackCompleted = false
  try {
    await assertPrivateBuckets(storage, decoded.manifest.files)
    await sql.begin(async (tx) => {
      const db = databaseAdapter(tx)
      await db.query("SET LOCAL lock_timeout='10000'")
      await db.query("SET LOCAL statement_timeout='30000'")
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtext('giapha_os_app_migrations'))"
      )
      await db.query(
        `LOCK TABLE ${BACKUP_TABLES.map((t) =>
          t
            .split('.')
            .map((p) => `"${p}"`)
            .join('.')
        ).join(',')} IN SHARE ROW EXCLUSIVE MODE`
      )
      const [operator] = await db.query(
        "SELECT id FROM public.profiles WHERE id=$1 AND role='admin' AND is_active",
        [actor]
      )
      if (!operator)
        throw new Error('Tài khoản không còn quyền quản trị tại nơi nhận.')
      await assertExclusiveRestoreOperator(db, actor)
      const adminMapping = await inspectDecoded(db, decoded, actor)
      if (
        JSON.stringify(adminMapping) !==
        JSON.stringify(preview.adminMapping ?? null)
      )
        throw new Error(
          'Dữ liệu ánh xạ admin đã đổi. Kiểm tra file lại trước khi khôi phục.'
        )
      if ((await targetFingerprint(db)) !== preview.fingerprint)
        throw new Error(
          'Dữ liệu nơi nhận đã đổi sau bước xem trước. Kiểm tra file lại trước khi khôi phục.'
        )
      const relocated = relocateBackup(
        adminMapping
          ? applyAdminAccountMapping(decoded.manifest, adminMapping)
          : decoded.manifest
      )
      for (const [index, file] of relocated.files.entries()) {
        const { error } = await storage.storage
          .from(file.bucket)
          .upload(file.path, new Uint8Array(decoded.files[index]), {
            contentType: file.mime,
            upsert: false
          })
        if (error)
          throw new Error(
            'File ảnh không tải lên được nơi nhận. Dữ liệu database được giữ nguyên.'
          )
        uploaded.push({ bucket: file.bucket, path: file.path })
        const { data, error: downloadError } = await storage.storage
          .from(file.bucket)
          .download(file.path)
        if (
          downloadError ||
          !data ||
          createHash('sha256')
            .update(Buffer.from(await data.arrayBuffer()))
            .digest('hex') !== file.sha256
        )
          throw new Error(
            'File ảnh nơi nhận không khớp bản sao lưu. Dữ liệu database được giữ nguyên.'
          )
      }
      await restoreWebsiteRows(
        db,
        relocated,
        actor,
        decoded.manifest.sourceProjectRef !== config.supabaseProjectRef,
        adminMapping
      )
      callbackCompleted = true
    })
    committed = true
    return {
      success: true,
      files: uploaded.length,
      users: decoded.manifest.tables['auth.users'].length,
      adminMapped: Boolean(preview.adminMapping),
      requiresLogin: decoded.manifest.tables['auth.users'].some(
        (u) => u.id === actor
      )
    }
  } finally {
    await sql.end().catch(() => {})
    // Never remove original objects. A failure cleans only the unique paths
    // created by this attempt. Interrupted requests may leave private orphan files.
    // A lost COMMIT acknowledgement is ambiguous: retain staged objects when
    // SQL writes finished, because the committed rows may already reference them.
    if (!committed && !callbackCompleted)
      for (const bucket of BACKUP_BUCKETS) {
        const paths = uploaded
          .filter((f) => f.bucket === bucket)
          .map((f) => f.path)
        if (paths.length)
          await storage.storage
            .from(bucket)
            .remove(paths)
            .catch(() => {})
      }
  }
}
