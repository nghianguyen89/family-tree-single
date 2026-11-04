import { createHash, randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'
import sharp from 'sharp'

import { contentImageMime, MAX_CONTENT_IMAGE_BYTES } from '@/utils/content'
import {
  isContentUploadSameOrigin,
  mediaUploadFailure
} from '@/utils/content-upload'
import { imageFileTitle } from '@/utils/image-upload'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

const fields =
  'id,title,description,event_date,width,height,library_visible,created_at,created_by'
const failure = (error: string, status = 400) =>
  NextResponse.json({ error }, { status })
export async function POST(request: Request) {
  if (!isContentUploadSameOrigin(request)) return failure('origin', 403)
  const profile = await getProfile()
  if (!profile?.is_active || !['admin', 'editor'].includes(profile.role))
    return failure('permission', 403)
  const maximum = MAX_CONTENT_IMAGE_BYTES + 65536
  if (Number(request.headers.get('content-length')) > maximum)
    return failure('size', 413)
  let form: FormData
  try {
    const reader = request.body?.getReader()
    if (!reader) return failure('invalid')
    const chunks: BlobPart[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximum) {
        await reader.cancel()
        return failure('size', 413)
      }
      chunks.push(new Uint8Array(value))
    }
    form = await new Response(new Blob(chunks), {
      headers: { 'Content-Type': request.headers.get('content-type') || '' }
    }).formData()
  } catch {
    return failure('invalid')
  }
  const file = form.get('file')
  if (!(file instanceof File) || !file.size) return failure('invalid')
  if (file.size > MAX_CONTENT_IMAGE_BYTES) return failure('size', 413)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime =
    contentImageMime(bytes) ||
    (/^GIF8[79]a/.test(new TextDecoder().decode(bytes.slice(0, 6)))
      ? 'image/gif'
      : null)
  const supplied = file.type.toLowerCase()
  if (
    !mime ||
    (supplied &&
      supplied !== 'application/octet-stream' &&
      supplied !== mime &&
      !(
        mime === 'image/jpeg' && ['image/jpg', 'image/pjpeg'].includes(supplied)
      ))
  )
    return failure('type', 415)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const db = await getSupabase()
  const { data: existing, error: lookupError } = await db
    .from('media_assets')
    .select(fields)
    .eq('content_hash', hash)
    .maybeSingle()
  if (lookupError) return failure(mediaUploadFailure(lookupError, 'database'))
  if (existing)
    return NextResponse.json(
      { asset: existing, reused: true },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  let width: number, height: number
  try {
    const metadata = await sharp(bytes, {
      limitInputPixels: 80_000_000
    }).metadata()
    width = metadata.width
    height = metadata.pageHeight || metadata.height
    if ([5, 6, 7, 8].includes(metadata.orientation || 0))
      [width, height] = [height, width]
    if (
      !width ||
      !height ||
      width * height > 80_000_000 ||
      Math.max(width, height) > 40000
    )
      return failure('type', 415)
  } catch {
    return failure('type', 415)
  }
  const id = randomUUID(),
    path = `${id}.${mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : mime === 'image/gif' ? 'gif' : 'webp'}`
  const { error: uploadError } = await db.storage
    .from('media-library')
    .upload(path, bytes, { contentType: mime, upsert: false })
  if (uploadError) return failure(mediaUploadFailure(uploadError, 'storage'))
  const { data, error } = await db
    .from('media_assets')
    .insert({
      id,
      storage_bucket: 'media-library',
      storage_path: path,
      content_hash: hash,
      title: imageFileTitle(file.name),
      width,
      height,
      library_visible: form.get('library_visible') === 'true'
    })
    .select(fields)
    .single()
  if (error) {
    await db.storage.from('media-library').remove([path])
    if (error.code === '23505') {
      const duplicate = await db
        .from('media_assets')
        .select(fields)
        .eq('content_hash', hash)
        .maybeSingle()
      if (duplicate.data)
        return NextResponse.json(
          { asset: duplicate.data, reused: true },
          { headers: { 'Cache-Control': 'no-store' } }
        )
    }
    return failure(mediaUploadFailure(error, 'database'))
  }
  return NextResponse.json(
    { asset: data, reused: false },
    { status: 201, headers: { 'Cache-Control': 'no-store' } }
  )
}
