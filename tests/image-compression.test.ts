import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AUTO_COMPRESS_IMAGE_BYTES,
  compressUploadImage,
  MAX_SOURCE_IMAGE_BYTES
} from '../utils/image-compression'

test('small uploads preserve original bytes, name and GIF animation without decoding', async () => {
  const file = new File(['small animated image'], 'animation.gif', {
    type: 'image/gif'
  })
  assert.equal(await compressUploadImage(file), file)
})

test('empty and excessive originals are rejected before decoding', async () => {
  await assert.rejects(
    compressUploadImage(new File([], 'empty.png')),
    /source-size/
  )
  const oversized = new File(['x'], 'huge.png')
  Object.defineProperty(oversized, 'size', {
    value: MAX_SOURCE_IMAGE_BYTES + 1
  })
  await assert.rejects(compressUploadImage(oversized), /source-size/)
})

test('large images use bounded, proportionate dimensions and release decoder/canvas on success and failure', async () => {
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document'
  )
  const previousDecoder = Object.getOwnPropertyDescriptor(
    globalThis,
    'createImageBitmap'
  )
  let closed = 0,
    fail = false,
    encodedWidth = 0,
    encodedHeight = 0
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage() {} }),
    toBlob(callback: (blob: Blob | null) => void) {
      encodedWidth = canvas.width
      encodedHeight = canvas.height
      callback(fail ? null : new Blob(['encoded'], { type: 'image/webp' }))
    }
  }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => canvas }
  })
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => ({ width: 6000, height: 4000, close: () => closed++ })
  })
  try {
    const file = new File(['original'], 'Family group.png', {
      type: 'image/png'
    })
    Object.defineProperty(file, 'size', {
      value: AUTO_COMPRESS_IMAGE_BYTES + 1
    })
    const compressed = await compressUploadImage(file)
    assert.equal(compressed.name, 'Family group.webp')
    assert.equal(compressed.type, 'image/webp')
    assert.ok(compressed.size < AUTO_COMPRESS_IMAGE_BYTES)
    assert.ok(
      encodedWidth <= 4096 &&
        Math.abs(encodedWidth / encodedHeight - 1.5) < 0.001
    )
    assert.equal(closed, 1)
    assert.equal(canvas.width, 0)
    fail = true
    await assert.rejects(compressUploadImage(file), /encode/)
    assert.equal(closed, 2)
    assert.equal(canvas.height, 0)
  } finally {
    if (previousDocument)
      Object.defineProperty(globalThis, 'document', previousDocument)
    else Reflect.deleteProperty(globalThis, 'document')
    if (previousDecoder)
      Object.defineProperty(globalThis, 'createImageBitmap', previousDecoder)
    else Reflect.deleteProperty(globalThis, 'createImageBitmap')
  }
})
