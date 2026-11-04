import { NextRequest, NextResponse } from 'next/server'

import { intakeMessages } from '@/lib/i18n/intake'
import { cleanPublicIntake, INTAKE_TOKEN, validateIntake } from '@/utils/intake'
import { getPublicIntakeClient } from '@/utils/supabase/public-intake'

export const runtime = 'nodejs'
const MAX_BYTES = 65536
const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow'
}

async function readBoundedBody(request: Request) {
  if (Number(request.headers.get('content-length')) > MAX_BYTES)
    throw new Error('size')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('body')
  let bytes = 0
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > MAX_BYTES) {
      await reader.cancel()
      throw new Error('size')
    }
    chunks.push(value)
  }
  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const locale = request.headers.get('accept-language')?.startsWith('en')
    ? 'en'
    : 'vi'
  const text = intakeMessages[locale]
  if (!INTAKE_TOKEN.test(token))
    return NextResponse.json(
      { error: text.unavailable },
      { status: 404, headers }
    )
  const origin = request.headers.get('origin')
  if (
    origin &&
    origin !== request.nextUrl.origin &&
    origin !== process.env.APP_URL?.replace(/\/$/, '')
  )
    return NextResponse.json({ error: text.error }, { status: 403, headers })
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return NextResponse.json({ error: text.invalid }, { status: 415, headers })
  let body: Record<string, unknown>
  try {
    body = await readBoundedBody(request)
  } catch (error) {
    return NextResponse.json(
      { error: text.invalid },
      { status: (error as Error).message === 'size' ? 413 : 400, headers }
    )
  }
  if (body.website || body.consent !== true || !validateIntake(body.payload))
    return NextResponse.json({ error: text.invalid }, { status: 400, headers })
  try {
    const { data, error } = await getPublicIntakeClient().rpc(
      'submit_family_intake',
      { link_token: token, submission: cleanPublicIntake(body.payload) }
    )
    if (error) {
      const limited = error.message.includes('limit reached')
      const invalidLink = error.message.includes('expired collection link')
      const missing = error.code === 'PGRST202'
      return NextResponse.json(
        {
          error: limited
            ? text.limited
            : missing
              ? text.error
              : invalidLink
                ? text.unavailable
                : text.invalid
        },
        {
          status: limited ? 429 : missing ? 503 : invalidLink ? 404 : 400,
          headers
        }
      )
    }
    return NextResponse.json({ receipt: data }, { status: 201, headers })
  } catch {
    return NextResponse.json({ error: text.error }, { status: 503, headers })
  }
}
