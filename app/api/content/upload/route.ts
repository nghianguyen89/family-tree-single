import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'

import {
  CONTENT_UUID,
  contentImageMime,
  MAX_CONTENT_IMAGE_BYTES
} from '@/utils/content'
import {
  contentUploadFailure,
  isContentUploadSameOrigin
} from '@/utils/content-upload'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

export async function POST(request: Request) {
  if (!isContentUploadSameOrigin(request))
    return NextResponse.json({ error: 'origin' }, { status: 403 })
  const profile = await getProfile()
  if (!profile?.is_active || !['admin', 'editor'].includes(profile.role))
    return NextResponse.json({ error: 'permission' }, { status: 403 })
  if (
    Number(request.headers.get('content-length')) >
    MAX_CONTENT_IMAGE_BYTES + 65536
  )
    return NextResponse.json({ error: 'size' }, { status: 413 })
  let form: FormData
  try {
    const reader = request.body?.getReader()
    if (!reader) throw new Error('empty')
    const chunks: BlobPart[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_CONTENT_IMAGE_BYTES + 65536) {
        await reader.cancel()
        return NextResponse.json({ error: 'size' }, { status: 413 })
      }
      chunks.push(new Uint8Array(value))
    }
    form = await new Response(new Blob(chunks), {
      headers: { 'Content-Type': request.headers.get('content-type') || '' }
    }).formData()
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }
  const file = form.get('file'),
    entryId = form.get('entry_id'),
    alt = form.get('alt')
  if (
    !(file instanceof File) ||
    file.size < 1 ||
    typeof alt !== 'string' ||
    !alt.trim() ||
    alt.length > 300 ||
    (entryId !== null &&
      (typeof entryId !== 'string' || !CONTENT_UUID.test(entryId)))
  )
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  if (file.size > MAX_CONTENT_IMAGE_BYTES)
    return NextResponse.json({ error: 'size' }, { status: 413 })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = contentImageMime(bytes)
  // Some browsers omit MIME or report JPEG aliases. The file signature is
  // authoritative; the normalized MIME is also what we send to Storage.
  const suppliedMime = file.type.toLowerCase()
  const jpegAlias =
    mime === 'image/jpeg' && ['image/jpg', 'image/pjpeg'].includes(suppliedMime)
  if (
    !mime ||
    (suppliedMime &&
      suppliedMime !== 'application/octet-stream' &&
      suppliedMime !== mime &&
      !jpegAlias)
  )
    return NextResponse.json({ error: 'type' }, { status: 415 })
  const db = await getSupabase()
  if (entryId) {
    const { data } = await db
      .from('home_content')
      .select('id')
      .eq('id', entryId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!data) return NextResponse.json({ error: 'notFound' }, { status: 404 })
  }
  let countQuery = db
    .from('home_content_images')
    .select('id', { count: 'exact', head: true })
  countQuery = entryId
    ? countQuery.eq('entry_id', entryId)
    : countQuery.is('entry_id', null)
  const { count, error: countError } = await countQuery
  if (countError)
    return NextResponse.json(
      { error: contentUploadFailure(countError, 'database') },
      { status: 400 }
    )
  if ((count || 0) >= 100)
    return NextResponse.json({ error: 'limit' }, { status: 400 })
  const position = Number(form.get('position') || 0)
  if (!Number.isInteger(position) || position < 0 || position > 10000)
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const id = randomUUID(),
    storagePath = `${id}.${mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp'}`
  const { error: uploadError } = await db.storage
    .from('home-content')
    .upload(storagePath, bytes, { contentType: mime, upsert: false })
  if (uploadError)
    return NextResponse.json(
      { error: contentUploadFailure(uploadError, 'storage') },
      { status: 400 }
    )
  const { data, error } = await db
    .from('home_content_images')
    .insert({
      id,
      entry_id: entryId,
      storage_path: storagePath,
      alt: alt.trim(),
      position
    })
    .select('*')
    .single()
  if (error) {
    await db.storage.from('home-content').remove([storagePath])
    return NextResponse.json(
      { error: contentUploadFailure(error, 'database') },
      { status: 400 }
    )
  }
  return NextResponse.json(
    { image: data },
    { status: 201, headers: { 'Cache-Control': 'no-store' } }
  )
}
