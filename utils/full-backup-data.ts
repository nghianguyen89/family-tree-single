import { createHash, randomUUID } from 'node:crypto'

import { getAvatarStoragePath } from './avatar'
import { validateImportPayload } from './backup-validation'
import type { BackupRow, WebsiteBackup } from './full-backup-archive'

export interface BackupDatabase {
  query(text: string, values?: unknown[]): Promise<BackupRow[]>
}

// Fixed application contract: archive input never supplies executable SQL.
export const BACKUP_TABLES = [
  'auth.users',
  'auth.identities',
  'public.profiles',
  'public.persons',
  'public.family_branches',
  'public.family_branch_members',
  'public.relationships',
  'public.person_details_private',
  'public.custom_events',
  'public.gallery_items',
  'public.home_content',
  'public.media_assets',
  'public.home_content_images',
  'public.home_settings',
  'public.family_intake_links',
  'public.family_intake_submissions',
  'public.user_approval_requests'
] as const
export const BACKUP_BUCKETS = [
  'avatars',
  'gallery',
  'home-content',
  'media-library'
] as const
export const BACKUP_ERROR =
  'Bản sao lưu hoặc môi trường không tương thích. Kiểm tra schema, tài khoản trùng và các liên kết dữ liệu.'
const fail = (): never => {
  throw new Error(BACKUP_ERROR)
}
export const quotedTable = (table: string) => {
  if (!(BACKUP_TABLES as readonly string[]).includes(table)) return fail()
  return table
    .split('.')
    .map((part) => `"${part}"`)
    .join('.')
}
const quotedColumn = (column: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(column)) return fail()
  return `"${column}"`
}

export async function readBackupSchema(db: BackupDatabase) {
  const result: WebsiteBackup['schema'] = {}
  for (const table of BACKUP_TABLES) {
    const [schema, name] = table.split('.')
    const columns = await db.query(
      `SELECT column_name AS name, udt_schema || '.' || udt_name AS type
      FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2
      AND is_generated='NEVER' AND is_identity='NO' ORDER BY ordinal_position`,
      [schema, name]
    )
    if (!columns.length) fail()
    result[table] = columns.map((c) => ({
      name: String(c.name),
      type: String(c.type)
    }))
  }
  return result
}

export async function readBackupRows(
  db: BackupDatabase,
  schema: WebsiteBackup['schema']
) {
  const tables: WebsiteBackup['tables'] = {}
  let count = 0
  for (const table of BACKUP_TABLES) {
    const rows = await db.query(
      `SELECT to_jsonb(t) AS row FROM ${quotedTable(table)} t LIMIT 100001`
    )
    count += rows.length
    if (count > 100000) fail()
    tables[table] = rows.map(({ row }) =>
      Object.fromEntries(
        schema[table].map((c) => [c.name, (row as BackupRow)[c.name]])
      )
    )
  }
  return tables
}

export function stripAuthTokens(tables: WebsiteBackup['tables']) {
  for (const user of tables['auth.users']) {
    for (const key of Object.keys(user)) {
      if (key.includes('token') && typeof user[key] === 'string') user[key] = ''
    }
    // Migration retains password hashes, not outstanding account change requests.
    for (const key of ['email_change', 'phone_change'])
      if (key in user) user[key] = ''
  }
}

export function validateWebsiteData(manifest: WebsiteBackup) {
  if (
    Object.keys(manifest.tables).sort().join() !==
      [...BACKUP_TABLES].sort().join() ||
    Object.keys(manifest.schema).sort().join() !==
      [...BACKUP_TABLES].sort().join()
  )
    fail()
  for (const table of BACKUP_TABLES) {
    const columns = manifest.schema[table]
    if (!Array.isArray(columns) || !columns.length || columns.length > 100)
      fail()
    const keys = new Set(columns.map((c) => c.name))
    if (keys.size !== columns.length) fail()
    for (const c of columns) quotedColumn(c.name)
    const ids = new Set()
    for (const row of manifest.tables[table]) {
      if (
        Object.keys(row).length !== keys.size ||
        Object.keys(row).some((k) => !keys.has(k))
      )
        fail()
      if (row.id != null) {
        if (ids.has(row.id)) fail()
        ids.add(row.id)
      }
    }
  }
  const t = manifest.tables
  const tree = {
    persons: t['public.persons'],
    relationships: t['public.relationships'],
    person_details_private: t['public.person_details_private'],
    custom_events: t['public.custom_events'],
    family_branches: t['public.family_branches'],
    family_branch_members: t['public.family_branch_members']
  }
  if (tree.persons.length) {
    if (validateImportPayload(tree, (k) => k)) fail()
  } else if (
    tree.relationships.length ||
    tree.person_details_private.length ||
    tree.family_branches.length ||
    tree.family_branch_members.length
  )
    fail()
  const users = new Set(t['auth.users'].map((u) => u.id))
  const people = new Set(tree.persons.map((p) => p.id))
  const personsById = new Map(tree.persons.map((p) => [p.id, p]))
  if (
    tree.family_branches.some((b) => {
      const anchor = personsById.get(b.anchor_person_id)
      return (
        !anchor || anchor.is_in_law !== true || anchor.family_branch_id != null
      )
    })
  )
    fail()
  if (
    tree.relationships.some(
      (r) =>
        r.family_branch_id == null &&
        (personsById.get(r.person_a)?.family_branch_id != null ||
          personsById.get(r.person_b)?.family_branch_id != null)
    )
  )
    fail()
  if (
    t['auth.users'].some(
      (u) =>
        u.role !== 'authenticated' ||
        u.is_sso_user === true ||
        u.is_super_admin === true
    )
  )
    fail()
  if (t['auth.identities'].some((i) => !users.has(i.user_id))) fail()
  if (
    t['public.profiles'].some(
      (p) =>
        !users.has(p.id) ||
        !['admin', 'editor', 'member'].includes(String(p.role)) ||
        (p.person_id != null && !people.has(p.person_id))
    )
  )
    fail()
  if (
    t['public.home_settings'].length !== 1 ||
    t['public.home_settings'][0].id !== 1
  )
    fail()
  const profiles = new Set(t['public.profiles'].map((p) => p.id))
  const placements = new Map(
    t['public.home_content_images'].map((p) => [p.id, p])
  )
  const cover = t['public.home_settings'][0].cover_image_id
  if (
    cover != null &&
    (!placements.has(cover) || placements.get(cover)?.entry_id != null)
  )
    fail()
  const assets = new Set(t['public.media_assets'].map((p) => p.id))
  const entries = new Set(t['public.home_content'].map((p) => p.id))
  if (
    t['public.home_content_images'].some(
      (p) =>
        (p.asset_id != null && !assets.has(p.asset_id)) ||
        (p.entry_id != null && !entries.has(p.entry_id))
    )
  )
    fail()
  if (
    !t['public.profiles'].some(
      (p) => p.role === 'admin' && p.is_active === true
    )
  )
    fail()
  const links = new Set(t['public.family_intake_links'].map((p) => p.id))
  if (t['public.family_intake_submissions'].some((s) => !links.has(s.link_id)))
    fail()
  for (const table of BACKUP_TABLES) {
    for (const row of t[table]) {
      for (const key of ['created_by', 'updated_by', 'reviewed_by'])
        if (row[key] != null && !users.has(row[key])) fail()
    }
  }
  if (t['public.user_approval_requests'].some((r) => !profiles.has(r.user_id)))
    fail()
}

export function assertMatchingSchema(
  source: WebsiteBackup['schema'],
  target: WebsiteBackup['schema']
) {
  // SQL restore addresses columns by name; physical order varies with migration history.
  const columns = (schema: WebsiteBackup['schema'], table: string) =>
    JSON.stringify(
      [...schema[table]].sort((a, b) => a.name.localeCompare(b.name))
    )
  for (const table of BACKUP_TABLES)
    if (columns(source, table) !== columns(target, table)) fail()
}

export async function assertOrdinaryAuth(db: BackupDatabase) {
  const [result] = await db.query(
    'SELECT count(*)::int AS n FROM auth.mfa_factors'
  )
  if (Number(result.n) !== 0)
    throw new Error(
      'Project có MFA; cần quy trình chuyển Supabase chuyên biệt để giữ yếu tố xác thực. Chưa hỗ trợ trong giao diện này.'
    )
}

export async function targetFingerprint(db: BackupDatabase) {
  const hash = createHash('sha256')
  for (const table of BACKUP_TABLES.filter((t) => t.startsWith('public.'))) {
    const [row] = await db.query(
      `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${quotedTable(table)} t`
    )
    hash.update(JSON.stringify(row.rows))
  }
  for (const table of ['auth.users', 'auth.identities']) {
    const auth = await db.query(
      `SELECT to_jsonb(t) AS row FROM ${quotedTable(table)} t ORDER BY id`
    )
    hash.update(JSON.stringify(auth))
  }
  return hash.digest('hex')
}

export async function assertExclusiveRestoreOperator(
  db: BackupDatabase,
  operator: string
) {
  const rows = await db.query(
    'SELECT id FROM public.profiles WHERE is_active AND id<>$1',
    [operator]
  )
  if (rows.length)
    throw new Error(
      'Nơi nhận còn tài khoản khác đang hoạt động. Tạm ngừng quyền truy cập của họ trước khi kiểm tra/khôi phục để ảnh riêng tư không bị đọc trong lúc chuyển.'
    )
}

export interface AdminAccountMapping {
  sourceId: string
  targetId: string
  email: string
}

export async function getAdminAccountMapping(
  db: BackupDatabase,
  manifest: WebsiteBackup,
  operatorId: string
): Promise<AdminAccountMapping | null> {
  const [target] = await db.query(
    `SELECT u.id,u.email,u.email_confirmed_at FROM auth.users u
     JOIN public.profiles p ON p.id=u.id
     WHERE u.id=$1 AND p.role='admin' AND p.is_active`,
    [operatorId]
  )
  if (!target?.email || !target.email_confirmed_at) return null
  const email = String(target.email).trim().toLowerCase()
  const matches = manifest.tables['auth.users'].filter(
    (u) => typeof u.email === 'string' && u.email.trim().toLowerCase() === email
  )
  if (matches.length !== 1) {
    if (matches.length > 1) fail()
    return null
  }
  const source = matches[0]
  if (source.id === operatorId || !source.email_confirmed_at) return null
  if (
    !manifest.tables['public.profiles'].some(
      (p) => p.id === source.id && p.role === 'admin' && p.is_active === true
    )
  )
    return null
  if (manifest.tables['auth.users'].some((u) => u.id === operatorId)) fail()
  return { sourceId: String(source.id), targetId: operatorId, email }
}

export function applyAdminAccountMapping(
  manifest: WebsiteBackup,
  mapping: AdminAccountMapping
): WebsiteBackup {
  const copy = structuredClone(manifest)
  // Keep the destination operator's Auth credentials, providers and live session.
  copy.tables['auth.users'] = copy.tables['auth.users'].filter(
    (u) => u.id !== mapping.sourceId
  )
  copy.tables['auth.identities'] = copy.tables['auth.identities'].filter(
    (i) => i.user_id !== mapping.sourceId
  )
  for (const table of BACKUP_TABLES) {
    if (!table.startsWith('public.')) continue
    for (const row of copy.tables[table]) {
      const keys = ['created_by', 'updated_by', 'reviewed_by']
      if (table === 'public.profiles') keys.push('id')
      if (table === 'public.user_approval_requests') keys.push('user_id')
      for (const key of keys)
        if (row[key] === mapping.sourceId) row[key] = mapping.targetId
    }
  }
  return copy
}

export async function assertNoAccountCollisions(
  db: BackupDatabase,
  manifest: WebsiteBackup
) {
  const users = await db.query('SELECT id,email,phone FROM auth.users')
  const identities = await db.query(
    'SELECT id,user_id,provider,provider_id FROM auth.identities'
  )
  for (const incoming of manifest.tables['auth.users']) {
    for (const current of users) {
      const sameEmail =
        incoming.email &&
        String(incoming.email).toLowerCase() ===
          String(current.email).toLowerCase()
      const samePhone = incoming.phone && incoming.phone === current.phone
      if ((sameEmail || samePhone) && incoming.id !== current.id)
        throw new Error(
          'Có tài khoản trùng email/số điện thoại nhưng khác ID ở nơi nhận. Hãy dùng project đích sạch và admin nhận có email riêng; chưa thay đổi dữ liệu.'
        )
      if (
        incoming.id === current.id &&
        (incoming.email !== current.email || incoming.phone !== current.phone)
      )
        fail()
    }
  }
  for (const incoming of manifest.tables['auth.identities'])
    for (const current of identities) {
      if (
        (incoming.id === current.id ||
          (incoming.provider === current.provider &&
            incoming.provider_id === current.provider_id)) &&
        incoming.user_id !== current.user_id
      )
        fail()
    }
}

function storagePath(bucket: string, value: unknown) {
  let path = String(value)
  if (path.startsWith('http')) {
    const match = new URL(path).pathname.match(
      /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/
    )
    if (!match || match[1] !== bucket) return fail()
    path = decodeURIComponent(match[2])
  }
  return path.replace(/^\/+/, '')
}

export function referencedBackupPaths(manifest: WebsiteBackup) {
  const paths = new Set<string>()
  const add = (bucket: string, value: unknown) => {
    if (value != null && value !== '')
      paths.add(`${bucket}/${storagePath(bucket, value)}`)
  }
  for (const person of manifest.tables['public.persons']) {
    if (!person.avatar_url) continue
    const path = getAvatarStoragePath(String(person.avatar_url))
    if (!path) fail()
    add('avatars', path)
  }
  for (const asset of manifest.tables['public.media_assets'])
    add(String(asset.storage_bucket), asset.storage_path)
  for (const image of manifest.tables['public.home_content_images'])
    if (!image.asset_id) add('home-content', image.storage_path)
  for (const image of manifest.tables['public.gallery_items'])
    add('gallery', image.image_url)
  return paths
}

export function relocateBackup(manifest: WebsiteBackup) {
  const copy = structuredClone(manifest)
  const nonce = randomUUID()
  const mappings = new Map<string, string>()
  const originalFiles = new Map(
    manifest.files.map((f) => [`${f.bucket}/${f.path}`, f])
  )
  for (const file of copy.files) {
    const original = file.path
    const prefix =
      file.bucket === 'avatars' && /^[0-9a-f-]{36}/i.test(original)
        ? `${original.slice(0, 36)}_`
        : ''
    // The legacy CMS proxy accepts UUID filenames for placements without an asset.
    const name =
      file.bucket === 'home-content'
        ? randomUUID()
        : `${prefix}restore-${nonce}-${mappings.size}`
    const next = `${name}.${original.split('.').pop() || 'bin'}`
    mappings.set(`${file.bucket}/${original}`, next)
    file.path = next
  }
  const pathFor = (bucket: string, value: unknown) => {
    if (value == null || value === '') return value
    const original = String(value)
    const path = storagePath(bucket, original)
    const next = mappings.get(`${bucket}/${path}`)
    if (!next)
      throw new Error(
        'Bản sao lưu thiếu file ảnh được dữ liệu tham chiếu. Chưa thay đổi nơi nhận.'
      )
    return next
  }
  for (const person of copy.tables['public.persons']) {
    if (person.avatar_url) {
      const p = getAvatarStoragePath(String(person.avatar_url))
      if (!p) fail()
      person.avatar_url = pathFor('avatars', p)
    }
  }
  for (const asset of copy.tables['public.media_assets']) {
    const original = originalFiles.get(
      `${asset.storage_bucket}/${asset.storage_path}`
    )
    if (asset.content_hash != null && original?.sha256 !== asset.content_hash)
      throw new Error(
        'File ảnh không khớp hash trong danh mục nguồn. Chưa thay đổi nơi nhận.'
      )
    asset.storage_path = pathFor(
      String(asset.storage_bucket),
      asset.storage_path
    )
  }
  const assets = new Map(
    copy.tables['public.media_assets'].map((a) => [a.id, a])
  )
  for (const image of copy.tables['public.home_content_images'])
    image.storage_path = image.asset_id
      ? assets.get(image.asset_id)?.storage_path
      : pathFor('home-content', image.storage_path)
  for (const image of copy.tables['public.gallery_items'])
    image.image_url = pathFor('gallery', image.image_url)
  return copy
}

const deleteOrder = [
  'public.user_approval_requests',
  'public.family_intake_submissions',
  'public.family_intake_links',
  'public.home_settings',
  'public.home_content_images',
  'public.media_assets',
  'public.home_content',
  'public.gallery_items',
  'public.custom_events',
  'public.relationships',
  'public.person_details_private',
  'public.family_branch_members',
  'public.family_branches',
  'public.persons'
]
const insertOrder = [
  'public.persons',
  'public.family_branches',
  'public.family_branch_members',
  'public.relationships',
  'public.person_details_private',
  'public.custom_events',
  'public.gallery_items',
  'public.home_content',
  'public.media_assets',
  'public.home_content_images',
  'public.home_settings',
  'public.family_intake_links',
  'public.family_intake_submissions',
  'public.user_approval_requests'
]
// All these application triggers change snapshot values or enforce insertion order.
// Constraints remain enabled; the portable tree validator runs before this block.
const restoreTriggers = new Set([
  'stamp_home_content',
  'stamp_home_settings',
  'link_editorial_asset',
  'tr_add_owned_person_to_branch',
  'tr_add_anchor_to_branch',
  'tr_guard_family_branch_membership',
  'tr_guard_branch_relationship',
  'tr_guard_family_branch_root',
  'tr_guard_branch_partner',
  'tr_clear_revoked_branch_partners',
  'tr_family_branches_updated_at',
  'tr_profiles_updated_at'
])

async function insertRows(
  db: BackupDatabase,
  table: string,
  rows: BackupRow[],
  schema: WebsiteBackup['schema'],
  upsert = false
) {
  if (!rows.length) return
  const columns = schema[table].map((c) => quotedColumn(c.name))
  const names = columns.join(',')
  const conflict = upsert
    ? ` ON CONFLICT(id) DO UPDATE SET ${columns
        .filter((c) => c !== '"id"')
        .map((c) => `${c}=excluded.${c}`)
        .join(',')}`
    : ''
  for (let i = 0; i < rows.length; i += 200) {
    // Bind serialized JSON as text so postgres.js does not JSON-encode it again.
    await db.query(
      `INSERT INTO ${quotedTable(table)} (${names}) SELECT ${names} FROM jsonb_populate_recordset(NULL::${quotedTable(table)},$1::text::jsonb)${conflict}`,
      [JSON.stringify(rows.slice(i, i + 200))]
    )
  }
}

// Caller owns the transaction, lock and post-preview fingerprint check.
export async function restoreWebsiteRows(
  db: BackupDatabase,
  manifest: WebsiteBackup,
  operatorId: string,
  crossProject: boolean,
  adminMapping?: AdminAccountMapping | null
) {
  if (adminMapping && adminMapping.targetId !== operatorId) fail()
  const [operator] = await db.query(
    "SELECT * FROM public.profiles WHERE id=$1 AND role='admin' AND is_active",
    [operatorId]
  )
  if (!operator)
    throw new Error('Tài khoản không còn quyền quản trị tại nơi nhận.')
  const personIds = new Set(manifest.tables['public.persons'].map((p) => p.id))
  const incomingUsers = new Set(manifest.tables['auth.users'].map((u) => u.id))
  const incomingOperator = manifest.tables['public.profiles'].find(
    (p) => p.id === operatorId
  )
  // The restore operator remains an active recovery admin; unrelated old accounts
  // keep Auth identities but lose website access after replacement.
  const retained = {
    ...operator,
    ...incomingOperator,
    id: operatorId,
    role: 'admin',
    is_active: true,
    person_id: incomingOperator
      ? (incomingOperator.person_id ?? null)
      : personIds.has(operator.person_id)
        ? operator.person_id
        : null
  }
  const changedTriggers =
    await db.query(`SELECT n.nspname || '.' || c.relname AS table_name,t.tgname,t.tgenabled
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled<>'D'`)
  const selected = changedTriggers.filter(
    (t) =>
      restoreTriggers.has(String(t.tgname)) &&
      (BACKUP_TABLES as readonly string[]).includes(String(t.table_name))
  )
  for (const t of selected)
    await db.query(
      `ALTER TABLE ${quotedTable(String(t.table_name))} DISABLE TRIGGER ${quotedColumn(String(t.tgname))}`
    )
  await db.query('SET CONSTRAINTS ALL DEFERRED')
  await db.query('UPDATE public.profiles SET person_id=NULL')
  for (const table of deleteOrder)
    await db.query(`DELETE FROM ${quotedTable(table)}`)
  await insertRows(
    db,
    'auth.users',
    manifest.tables['auth.users'],
    manifest.schema,
    true
  )
  // Provider identities are part of the restored login state. Replace them for
  // incoming users so unlink/relink UUID changes cannot cause unique conflicts
  // and providers linked after the backup do not retain access.
  const ids = [...incomingUsers]
  await db.query('DELETE FROM auth.identities WHERE user_id=ANY($1::uuid[])', [
    ids
  ])
  await insertRows(
    db,
    'auth.identities',
    manifest.tables['auth.identities'],
    manifest.schema,
    true
  )
  // Existing sessions must not survive password/profile replacement. Source
  // sessions, refresh tokens and action tokens are deliberately not imported.
  await db.query(
    'DELETE FROM auth.refresh_tokens WHERE user_id=ANY($1::text[])',
    [ids]
  )
  await db.query('DELETE FROM auth.sessions WHERE user_id=ANY($1::uuid[])', [
    ids
  ])
  await db.query(
    "UPDATE public.profiles SET role='member',is_active=false,person_id=NULL WHERE id<>$1",
    [operatorId]
  )
  for (const table of insertOrder) {
    const rows = manifest.tables[table].map((row) => {
      if (table === 'public.family_intake_links' && crossProject)
        return { ...row, is_active: false }
      if (table === 'public.user_approval_requests')
        return { ...row, used_at: new Date().toISOString() }
      return row
    })
    await insertRows(db, table, rows, manifest.schema)
  }
  const profiles = manifest.tables['public.profiles'].filter(
    (p) => p.id !== operatorId
  )
  // Avoid assigning the same person to two accounts when source and target
  // operator accounts differ. Source mappings win; target operator can relink.
  if (profiles.some((p) => p.person_id && p.person_id === retained.person_id))
    retained.person_id = null
  await insertRows(
    db,
    'public.profiles',
    [...profiles, retained],
    manifest.schema,
    true
  )
  await db.query('SET CONSTRAINTS ALL IMMEDIATE')
  for (const t of selected) {
    const state =
      t.tgenabled === 'R'
        ? 'ENABLE REPLICA'
        : t.tgenabled === 'A'
          ? 'ENABLE ALWAYS'
          : 'ENABLE'
    await db.query(
      `ALTER TABLE ${quotedTable(String(t.table_name))} ${state} TRIGGER ${quotedColumn(String(t.tgname))}`
    )
  }
}
