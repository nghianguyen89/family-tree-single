import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getAvatarCrop } from '../utils/avatarCrop'

test('crop stays inside landscape, portrait and square photos at every corner and zoom', () => {
  for (const [width, height] of [
    [1200, 600],
    [600, 1200],
    [100, 100]
  ]) {
    for (const zoom of [1, 3, 16]) {
      for (const position of [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: -2, y: 4 }
      ]) {
        const { x, y, size } = getAvatarCrop(width, height, zoom, position)
        assert.ok(x >= 0 && y >= 0 && x + size <= width && y + size <= height)
        assert.equal(size, Math.min(width, height) / zoom)
      }
    }
  }
})

test('selecting the rightmost face in a group excludes the center face', () => {
  const crop = getAvatarCrop(1200, 600, 3, { x: 1, y: 0.5 })
  assert.deepEqual(crop, { x: 1000, y: 200, size: 200 })
})
