import assert from 'node:assert/strict'
import { test } from 'node:test'

import { contentText, contentUploadErrorText } from '../lib/i18n/content'
import {
  contentUploadFailure,
  isContentUploadSameOrigin,
  mediaUploadFailure
} from '../utils/content-upload'

test('upload origin uses the requested Host when Next canonicalizes a loopback URL', () => {
  const request = (origin: string, host?: string, forwarded?: string) =>
    new Request('http://localhost:3000/api/content/upload', {
      method: 'POST',
      headers: {
        origin,
        ...(host ? { host } : {}),
        ...(forwarded ? { 'x-forwarded-host': forwarded } : {})
      }
    })
  assert.equal(
    isContentUploadSameOrigin(request('http://localhost:3000')),
    true
  )
  assert.equal(
    isContentUploadSameOrigin(
      request('http://127.0.0.1:3000', '127.0.0.1:3000')
    ),
    true
  )
  assert.equal(
    isContentUploadSameOrigin(
      request('http://192.168.1.10:3000', '192.168.1.10:3000')
    ),
    true
  )
  assert.equal(
    isContentUploadSameOrigin(
      request('https://attacker.example', 'localhost:3000', 'attacker.example')
    ),
    false
  )
  assert.equal(
    isContentUploadSameOrigin(
      request('http://localhost:3001', 'localhost:3000')
    ),
    false
  )
  assert.equal(
    isContentUploadSameOrigin(
      request('https://localhost:3000', 'localhost:3000')
    ),
    false
  )
  assert.equal(
    isContentUploadSameOrigin(
      new Request('http://localhost:3000/api/content/upload', {
        method: 'POST'
      })
    ),
    false
  )
})

test('upload failures distinguish schema, policies, missing bucket and limits without exposing raw errors', () => {
  assert.equal(
    contentUploadFailure(
      { code: '42501', message: 'sensitive database detail' },
      'database'
    ),
    'databasePermission'
  )
  assert.equal(contentUploadFailure({ code: 'PGRST205' }, 'database'), 'schema')
  assert.equal(
    contentUploadFailure(
      { statusCode: '404', message: 'Bucket not found' },
      'storage'
    ),
    'bucket'
  )
  assert.equal(
    contentUploadFailure(
      {
        statusCode: '403',
        message: 'new row violates row-level security policy'
      },
      'storage'
    ),
    'storagePermission'
  )
  assert.equal(contentUploadFailure({ statusCode: '413' }, 'storage'), 'size')
  assert.equal(
    contentUploadFailure({ message: 'mime type is not supported' }, 'storage'),
    'type'
  )
  assert.equal(
    contentUploadErrorText('size', 'vi'),
    contentText('vi').uploadSize
  )
  assert.equal(
    contentUploadErrorText(undefined, 'vi', 413),
    contentText('vi').uploadSize
  )
  assert.equal(
    contentUploadErrorText('arbitrary secret detail', 'vi'),
    contentText('vi').imageError
  )
  assert.equal(
    contentUploadErrorText('__proto__', 'en'),
    contentText('en').imageError
  )
})

test('shared media errors identify the current bucket and distinguish database permissions from Storage', () => {
  assert.equal(
    mediaUploadFailure({ statusCode: '403' }, 'storage'),
    'mediaStoragePermission'
  )
  assert.equal(
    mediaUploadFailure({ code: '42501' }, 'database'),
    'databasePermission'
  )
  assert.equal(
    mediaUploadFailure({ code: 'PGRST205' }, 'database'),
    'mediaSchema'
  )
  assert.equal(
    mediaUploadFailure(
      { statusCode: '404', message: 'Bucket not found' },
      'storage'
    ),
    'mediaBucket'
  )
  for (const locale of ['vi', 'en']) {
    assert.match(
      contentUploadErrorText('mediaStoragePermission', locale),
      /media-library/
    )
    assert.doesNotMatch(
      contentUploadErrorText('mediaStoragePermission', locale),
      /home-content/
    )
    assert.match(
      contentUploadErrorText('mediaSchema', locale),
      /20261015010000_shared_media_library.sql/
    )
  }
})
