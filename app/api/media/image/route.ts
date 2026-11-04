import { NextResponse } from 'next/server'

import { CONTENT_UUID } from '@/utils/content'
import { downloadedImageMime } from '@/utils/image-response'
import { getAdminSupabase } from '@/utils/supabase/admin'
import { getSupabase } from '@/utils/supabase/queries'

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id || !CONTENT_UUID.test(id))
    return new NextResponse('Invalid id', { status: 400 })
  const db = await getSupabase()
  const { data: allowed, error } = await db.rpc('can_read_media_asset', {
    asset: id
  })
  if (error || !allowed) return new NextResponse('Not found', { status: 404 })
  try {
    const admin = getAdminSupabase()
    const { data: asset } = await admin
      .from('media_assets')
      .select('storage_bucket,storage_path')
      .eq('id', id)
      .maybeSingle()
    if (
      !asset ||
      !['gallery', 'home-content', 'media-library'].includes(
        asset.storage_bucket
      ) ||
      !asset.storage_path ||
      asset.storage_path.includes('..') ||
      /^[\/]|:|\\/.test(asset.storage_path)
    )
      return new NextResponse('Not found', { status: 404 })
    const { data, error: downloadError } = await admin.storage
      .from(asset.storage_bucket)
      .download(asset.storage_path)
    if (downloadError || !data)
      return new NextResponse('Not found', { status: 404 })
    const mime = await downloadedImageMime(data)
    if (
      !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(
        mime || ''
      )
    )
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
