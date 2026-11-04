import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt
} from 'node:crypto'

export const MAX_BACKUP_BYTES = 128 * 1024 * 1024
export const MAX_BACKUP_REQUEST_BYTES = MAX_BACKUP_BYTES + 65536
export const MAX_MANIFEST_BYTES = 32 * 1024 * 1024
export const MAX_FILES = 10000

export type BackupRow = Record<string, unknown>

export interface BackupFile {
  bucket: string
  path: string
  size: number
  sha256: string
  mime: string
}

export interface WebsiteBackup {
  format: 1
  createdAt: string
  appVersion: string
  sourceProjectRef: string
  schema: Record<string, Array<{ name: string; type: string }>>
  tables: Record<string, BackupRow[]>
  files: BackupFile[]
}

export interface DecodedBackup {
  manifest: WebsiteBackup
  files: Buffer[]
}

const MAGIC = Buffer.from('FTFULL01')
const AAD_BYTES = 36 // Magic, 16-byte salt, and 12-byte IV.
const HEADER_BYTES = AAD_BYTES + 16
const buckets = new Set(['avatars', 'gallery', 'home-content', 'media-library'])
const mimes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const errorMessage = 'Invalid backup or password.'

function check(condition: unknown): asserts condition {
  if (!condition) throw new Error(errorMessage)
}

function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
}

function keys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value)
  check(
    actual.length === expected.length &&
      expected.every((key) => Object.hasOwn(value, key))
  )
}

function text(value: unknown, maximum = 128): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maximum
  )
}

// Bound serialization before creating its JSON string. A final byte check also
// accounts for JSON escaping, which can expand strings beyond their UTF-8 size.
function validateJson(value: unknown, depth = 0, budget = { bytes: 0 }) {
  check(depth <= 64)
  if (typeof value === 'string') budget.bytes += Buffer.byteLength(value) + 2
  else if (typeof value === 'number') {
    check(Number.isFinite(value))
    budget.bytes += 24
  } else if (value === null || typeof value === 'boolean') budget.bytes += 5
  else {
    check(Array.isArray(value) || record(value))
    budget.bytes += 2
    if (Array.isArray(value)) {
      for (const item of value) {
        budget.bytes++
        validateJson(item, depth + 1, budget)
      }
    } else {
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue
        budget.bytes += Buffer.byteLength(key) + 4
        check(budget.bytes <= MAX_MANIFEST_BYTES)
        validateJson(value[key], depth + 1, budget)
      }
    }
  }
  check(budget.bytes <= MAX_MANIFEST_BYTES)
}

function validateManifest(value: unknown): asserts value is WebsiteBackup {
  check(record(value))
  keys(value, [
    'format',
    'createdAt',
    'appVersion',
    'sourceProjectRef',
    'schema',
    'tables',
    'files'
  ])
  check(
    value.format === 1 &&
      text(value.createdAt, 64) &&
      Number.isFinite(Date.parse(value.createdAt))
  )
  check(text(value.appVersion) && text(value.sourceProjectRef))
  check(record(value.schema) && record(value.tables))
  keys(value.tables, Object.keys(value.schema))
  let rowCount = 0
  for (const [table, columns] of Object.entries(value.schema)) {
    check(text(table) && Array.isArray(columns))
    const names = new Set<string>()
    for (const column of columns) {
      check(record(column))
      keys(column, ['name', 'type'])
      check(
        text(column.name) && text(column.type, 512) && !names.has(column.name)
      )
      names.add(column.name)
    }
    const rows = value.tables[table]
    check(Array.isArray(rows))
    rowCount += rows.length
    check(rowCount <= 100000 && rows.every(record))
  }
  check(Array.isArray(value.files) && value.files.length <= MAX_FILES)
  const paths = new Set<string>()
  let total = HEADER_BYTES + 4
  for (const file of value.files) {
    check(record(file))
    keys(file, ['bucket', 'path', 'size', 'sha256', 'mime'])
    check(typeof file.bucket === 'string' && buckets.has(file.bucket))
    check(
      text(file.path, 400) &&
        !/(^[\/]|\.\.|[:\\%?#]|[\x00-\x1f\x7f])/.test(file.path)
    )
    check(Number.isSafeInteger(file.size) && (file.size as number) >= 0)
    check(typeof file.sha256 === 'string' && /^[0-9a-f]{64}$/.test(file.sha256))
    check(typeof file.mime === 'string' && mimes.has(file.mime))
    const path = `${file.bucket}/${file.path}`
    check(!paths.has(path))
    paths.add(path)
    total += file.size as number
    check(total <= MAX_BACKUP_BYTES)
  }
}

function validatePassword(password: string) {
  check(
    typeof password === 'string' &&
      password.length >= 12 &&
      password.length <= 256
  )
}

function deriveKey(password: string, salt: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      32,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(new Error(errorMessage))
        else resolve(key)
      }
    )
  })
}

export function backupDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function encodeWebsiteBackup(
  manifest: WebsiteBackup,
  files: Uint8Array[],
  password: string
): Promise<Buffer> {
  let key: Buffer | undefined
  let plain: Buffer | undefined
  try {
    validatePassword(password)
    validateManifest(manifest)
    check(Array.isArray(files) && files.length === manifest.files.length)
    let fileBytes = 0
    for (let index = 0; index < files.length; index++) {
      const file = files[index]
      check(
        file instanceof Uint8Array &&
          file.byteLength === manifest.files[index].size
      )
      fileBytes += file.byteLength
      check(fileBytes + HEADER_BYTES + 4 <= MAX_BACKUP_BYTES)
      check(backupDigest(file) === manifest.files[index].sha256)
    }
    validateJson(manifest)
    const json = JSON.stringify(manifest)
    const manifestBytes = Buffer.byteLength(json)
    check(manifestBytes <= MAX_MANIFEST_BYTES)
    check(HEADER_BYTES + 4 + manifestBytes + fileBytes <= MAX_BACKUP_BYTES)
    plain = Buffer.allocUnsafe(4 + manifestBytes + fileBytes)
    plain.writeUInt32BE(manifestBytes)
    plain.write(json, 4, manifestBytes, 'utf8')
    let offset = 4 + manifestBytes
    for (const file of files) {
      plain.set(file, offset)
      offset += file.byteLength
    }
    const header = Buffer.concat([MAGIC, randomBytes(16), randomBytes(12)])
    key = await deriveKey(password, header.subarray(8, 24))
    const cipher = createCipheriv(
      'aes-256-gcm',
      key,
      header.subarray(24, AAD_BYTES)
    )
    cipher.setAAD(header)
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
    return Buffer.concat([header, cipher.getAuthTag(), encrypted])
  } catch {
    throw new Error(errorMessage)
  } finally {
    key?.fill(0)
    plain?.fill(0)
  }
}

export async function decodeWebsiteBackup(
  bytes: Uint8Array,
  password: string
): Promise<DecodedBackup> {
  let key: Buffer | undefined
  let plain: Buffer | undefined
  try {
    validatePassword(password)
    check(
      bytes instanceof Uint8Array &&
        bytes.byteLength >= HEADER_BYTES + 4 &&
        bytes.byteLength <= MAX_BACKUP_BYTES
    )
    // Copy bounded input before awaiting so callers cannot mutate an in-flight archive.
    const archive = Buffer.from(bytes)
    check(archive.subarray(0, 8).equals(MAGIC))
    key = await deriveKey(password, archive.subarray(8, 24))
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      archive.subarray(24, AAD_BYTES)
    )
    decipher.setAAD(archive.subarray(0, AAD_BYTES))
    decipher.setAuthTag(archive.subarray(AAD_BYTES, HEADER_BYTES))
    plain = decipher.update(archive.subarray(HEADER_BYTES))
    check(decipher.final().length === 0)
    const manifestBytes = plain.readUInt32BE(0)
    check(
      manifestBytes > 0 &&
        manifestBytes <= MAX_MANIFEST_BYTES &&
        manifestBytes <= plain.length - 4
    )
    const jsonBytes = plain.subarray(4, 4 + manifestBytes)
    const json = new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes)
    const manifest: unknown = JSON.parse(json)
    validateManifest(manifest)
    validateJson(manifest)
    let offset = 4 + manifestBytes
    check(
      offset + manifest.files.reduce((sum, file) => sum + file.size, 0) ===
        plain.length
    )
    const files = manifest.files.map((file) => {
      const data = plain!.subarray(offset, offset + file.size)
      check(backupDigest(data) === file.sha256)
      offset += file.size
      return Buffer.from(data)
    })
    return { manifest, files }
  } catch {
    throw new Error(errorMessage)
  } finally {
    key?.fill(0)
    plain?.fill(0)
  }
}
