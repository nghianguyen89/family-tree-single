import assert from 'node:assert/strict'
import { test } from 'node:test'

import { downloadedImageMime } from '../utils/image-response'

test('missing or generic Blob MIME is recovered from supported signatures', async () => {
  for (const [signature, mime] of [
    ['ffd8ff', 'image/jpeg'],
    ['89504e470d0a1a0a', 'image/png'],
    ['524946460000000057454250', 'image/webp'],
    ['474946383761', 'image/gif'],
    ['474946383961', 'image/gif']
  ]) {
    for (const type of ['', 'application/octet-stream']) {
      assert.equal(
        await downloadedImageMime(
          new Blob([Buffer.from(signature, 'hex')], { type })
        ),
        mime
      )
    }
  }
})

test('unknown bytes stay rejected and declared MIME is normalized without guessing by filename', async () => {
  assert.equal(
    await downloadedImageMime(new Blob(['<html>not an image</html>'])),
    null
  )
  assert.equal(await downloadedImageMime(new Blob([])), null)
  assert.equal(
    await downloadedImageMime(new Blob(['<svg/>'], { type: 'image/svg+xml' })),
    'image/svg+xml'
  )
  assert.equal(
    await downloadedImageMime(
      new Blob([], { type: 'image/png; charset=utf-8' })
    ),
    'image/png'
  )
})
