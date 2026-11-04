import { NextResponse } from 'next/server'

import { GET as mediaImage } from '@/app/api/media/image/route'
import { CONTENT_UUID } from '@/utils/content'
import { downloadedImageMime } from '@/utils/image-response'
import { getAdminSupabase } from '@/utils/supabase/admin'
import { getSupabase } from '@/utils/supabase/queries'

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id || !CONTENT_UUID.test(id))
    return new NextResponse('Invalid id', { status: 400 })
  // The session client applies public/member/editor RLS before the service client downloads.
  const db = await getSupabase()
  const { data: image, error } = await db
    .from('home_content_images')
    .select('storage_path,asset_id')
    .eq('id', id)
    .maybeSingle()
  if (image?.asset_id && !error)
    return mediaImage(
      new Request(
        new URL(`/api/media/image?id=${image.asset_id}`, request.url),
        { headers: request.headers }
      )
    )
  if (
    error ||
    !image ||
    !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(image.storage_path)
  )
    return new NextResponse('Not found', { status: 404 })
  try {
    const { data, error: downloadError } = await getAdminSupabase()
      .storage.from('home-content')
      .download(image.storage_path)
    if (downloadError || !data)
      return new NextResponse('Not found', { status: 404 })
    const mime = await downloadedImageMime(data)
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime || ''))
      return new NextResponse('Unsupported image', { status: 415 })
    return new NextResponse(data, {
      headers: {
        'Content-Type': mime!,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      }
    })
  } catch {
    return new NextResponse('Image unavailable', { status: 503 })
  }
}
