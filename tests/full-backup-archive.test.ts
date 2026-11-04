import assert from 'node:assert/strict'
import { createCipheriv, randomBytes, scrypt } from 'node:crypto'
import { test } from 'node:test'

import {
  backupDigest,
  decodeWebsiteBackup,
  encodeWebsiteBackup,
  MAX_BACKUP_BYTES,
  MAX_FILES,
  MAX_MANIFEST_BYTES,
  type WebsiteBackup
} from '../utils/full-backup-archive'

const password = 'backup test password with spaces'
const image = Buffer.from('private image bytes')

function fixture(): WebsiteBackup {
  return {
    format: 1,
    createdAt: '2026-10-22T00:00:00.000Z',
    appVersion: '2.3.0',
    sourceProjectRef: 'fictional-project',
    schema: { persons: [{ name: 'id', type: 'uuid' }] },
    tables: { persons: [{ id: 'fictional-person', note: 'Gia đình 🌳' }] },
    files: [
      {
        bucket: 'avatars',
        path: 'person_photo.webp',
        size: image.length,
        sha256: backupDigest(image),
        mime: 'image/webp'
      }
    ]
  }
}

// Build authenticated malformed plaintext to exercise validation after decryption.
async function seal(manifest: unknown, body = image, declaredLength?: number) {
  const json = Buffer.from(JSON.stringify(manifest))
  const length = Buffer.alloc(4)
  length.writeUInt32BE(declaredLength ?? json.length)
  const header = Buffer.concat([
    Buffer.from('FTFULL01'),
    randomBytes(16),
    randomBytes(12)
  ])
  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      header.subarray(8, 24),
      32,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key))
    )
  })
  const cipher = createCipheriv('aes-256-gcm', key, header.subarray(24))
  cipher.setAAD(header)
  const encrypted = Buffer.concat([
    cipher.update(Buffer.concat([length, json, body])),
    cipher.final()
  ])
  key.fill(0)
  return Buffer.concat([header, cipher.getAuthTag(), encrypted])
}

test('encrypted archive round-trips manifest and private bytes with random salt and IV', async () => {
  const manifest = fixture()
  const archive = await encodeWebsiteBackup(manifest, [image], password)
  assert.equal(archive.subarray(0, 8).toString(), 'FTFULL01')
  assert.equal(archive.includes(image), false)
  assert.equal(archive.includes(Buffer.from('fictional-person')), false)
  const decoded = await decodeWebsiteBackup(archive, password)
  assert.deepEqual(decoded.manifest, manifest)
  assert.deepEqual(decoded.files, [image])
  assert.notDeepEqual(
    await encodeWebsiteBackup(manifest, [image], password),
    archive
  )
  assert.equal(
    backupDigest(Buffer.from('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  )
})

test('empty website and zero-byte object round-trip', async () => {
  const manifest = fixture()
  manifest.tables.persons = []
  manifest.files = []
  assert.deepEqual(
    (
      await decodeWebsiteBackup(
        await encodeWebsiteBackup(manifest, [], password),
        password
      )
    ).files,
    []
  )
  manifest.files = [
    { ...fixture().files[0], size: 0, sha256: backupDigest(Buffer.alloc(0)) }
  ]
  assert.deepEqual(
    (
      await decodeWebsiteBackup(
        await encodeWebsiteBackup(manifest, [Buffer.alloc(0)], password),
        password
      )
    ).files,
    [Buffer.alloc(0)]
  )
})

test('wrong password and tampering with salt, IV, tag or ciphertext reveal only a generic error', async () => {
  const archive = await encodeWebsiteBackup(fixture(), [image], password)
  await assert.rejects(decodeWebsiteBackup(archive, 'different password'), {
    message: 'Invalid backup or password.'
  })
  for (const index of [0, 8, 24, 36, archive.length - 1]) {
    const corrupt = Buffer.from(archive)
    corrupt[index] ^= 1
    await assert.rejects(decodeWebsiteBackup(corrupt, password), {
      message: 'Invalid backup or password.'
    })
  }
  await assert.rejects(
    decodeWebsiteBackup(archive.subarray(0, archive.length - 1), password)
  )
})

test('rejects unsafe paths, duplicate objects, bucket/MIME/hash/size errors before encryption', async () => {
  for (const path of [
    '../photo.webp',
    'folder/../photo.webp',
    '/photo.webp',
    '\\photo.webp',
    'C:photo.webp',
    'folder/%2e%2e/photo.webp',
    'photo.webp?other=object',
    'photo.webp#fragment',
    'photo\n.webp',
    'x'.repeat(401)
  ]) {
    const manifest = fixture()
    manifest.files[0].path = path
    await assert.rejects(encodeWebsiteBackup(manifest, [image], password))
  }
  for (const changes of [
    { bucket: 'unknown' },
    { mime: 'text/html' },
    { sha256: '0'.repeat(64) },
    { size: image.length + 1 },
    { size: -1 },
    { size: MAX_BACKUP_BYTES },
    { size: 0.5 }
  ]) {
    const manifest = fixture()
    Object.assign(manifest.files[0], changes)
    await assert.rejects(encodeWebsiteBackup(manifest, [image], password))
  }
  const manifest = fixture()
  manifest.files.push({ ...manifest.files[0] })
  await assert.rejects(encodeWebsiteBackup(manifest, [image, image], password))
  manifest.files = Array.from(
    { length: MAX_FILES + 1 },
    () => fixture().files[0]
  )
  await assert.rejects(encodeWebsiteBackup(manifest, [], password))
})

test('bounds password, archive, manifest and global row count', async () => {
  for (const invalid of ['short', 'x'.repeat(257)]) {
    await assert.rejects(encodeWebsiteBackup(fixture(), [image], invalid))
    await assert.rejects(decodeWebsiteBackup(Buffer.alloc(0), invalid))
  }
  await assert.rejects(decodeWebsiteBackup(Buffer.alloc(51), password))
  await assert.rejects(
    decodeWebsiteBackup(Buffer.alloc(MAX_BACKUP_BYTES + 1), password)
  )
  const oversized = fixture()
  oversized.tables.persons = [{ note: 'x'.repeat(MAX_MANIFEST_BYTES) }]
  await assert.rejects(encodeWebsiteBackup(oversized, [image], password))
  oversized.tables.persons = Array.from({ length: 100001 }, () => ({}))
  await assert.rejects(encodeWebsiteBackup(oversized, [image], password))
})

test('valid authentication cannot hide malformed structure, file hashes or trailing payload', async () => {
  const malformed = fixture()
  malformed.files[0].path = '../private.webp'
  await assert.rejects(decodeWebsiteBackup(await seal(malformed), password))
  await assert.rejects(
    decodeWebsiteBackup(
      await seal({ ...fixture(), unexpected: true }),
      password
    )
  )
  await assert.rejects(
    decodeWebsiteBackup(
      await seal({ ...fixture(), tables: { persons: [null] } }),
      password
    )
  )
  const alteredImage = Buffer.from(image)
  alteredImage[0] ^= 1
  await assert.rejects(
    decodeWebsiteBackup(await seal(fixture(), alteredImage), password)
  )
  await assert.rejects(
    decodeWebsiteBackup(
      await seal(fixture(), Buffer.concat([image, Buffer.from('trailing')])),
      password
    )
  )
  await assert.rejects(
    decodeWebsiteBackup(
      await seal(fixture(), image, MAX_MANIFEST_BYTES + 1),
      password
    )
  )
})

test('scrypt yields to the event loop while deriving the key', async () => {
  let timerRan = false
  const timer = setTimeout(() => {
    timerRan = true
  }, 0)
  await encodeWebsiteBackup(fixture(), [image], password)
  clearTimeout(timer)
  assert.equal(timerRan, true)
})
