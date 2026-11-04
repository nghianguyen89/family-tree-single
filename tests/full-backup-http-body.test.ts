import assert from 'node:assert/strict'
import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { test } from 'node:test'

import { getCloneableBody } from 'next/dist/server/body-streams'

import config from '../next.config'

test('Next proxy forwards a backup request larger than its default 10 MiB buffer intact', async () => {
  const socket = new Socket()
  try {
    const request = new IncomingMessage(socket)
    request.url = '/api/website-backup'
    const limit = config.experimental?.proxyClientMaxBodySize
    assert.equal(typeof limit, 'number')
    const body = getCloneableBody(request, limit as number)
    const proxyStream = body.cloneBodyStream()
    const chunk = Buffer.alloc(1024 * 1024, 7)
    for (let i = 0; i < 11; i++) request.push(chunk)
    request.push(null)
    let proxyBytes = 0
    for await (const bytes of proxyStream) proxyBytes += bytes.length
    assert.equal(proxyBytes, 11 * chunk.length)
    await body.finalize()
    let routeBytes = 0
    for await (const bytes of request) routeBytes += bytes.length
    assert.equal(routeBytes, proxyBytes)
  } finally {
    socket.destroy()
  }
})
