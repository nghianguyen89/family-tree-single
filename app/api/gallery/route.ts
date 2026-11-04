import { NextResponse } from 'next/server'

import { GET as mediaImage } from '@/app/api/media/image/route'
import { downloadedImageMime } from '@/utils/image-response'
import { getAdminSupabase } from '@/utils/supabase/admin'
import { getProfile, getSupabase, getUser } from '@/utils/supabase/queries'
import { getGalleryStoragePath } from '@/utils/supabase/storage-path'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    return new NextResponse('Invalid image id', { status: 400 })
  }
  if (!(await getUser())) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  if (!(await getProfile())?.is_active) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  const supabase = await getSupabase()
  // Old bookmarks keep their IDs, but use the shared asset's current permissions.
  const shared = await supabase
    .from('media_assets')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (!shared.error)
    return mediaImage(
      new Request(new URL(`/api/media/image?id=${id}`, request.url), {
        headers: request.headers
      })
    )
  if (shared.error.code !== '42P01' && shared.error.code !== 'PGRST205')
    return new NextResponse('Not found', { status: 404 })
  const { data: item } = await supabase
    .from('gallery_items')
    .select('image_url')
    .eq('id', id)
    .maybeSingle()
  if (!item) return new NextResponse('Not found', { status: 404 })
  const path = getGalleryStoragePath(item.image_url)
  if (!path || path.length > 512 || path.includes('..')) {
    return new NextResponse('Invalid image path', { status: 400 })
  }
  // Members cannot mint shareable signed URLs directly from Storage. Use the
  // server-only client only after checking the session, profile, and item RLS.
  const { data, error } = await getAdminSupabase()
    .storage.from('gallery')
    .download(path)
  if (error || !data) return new NextResponse('Not found', { status: 404 })
  const mime = await downloadedImageMime(data)
  if (
    !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime || '')
  ) {
    return new NextResponse('Unsupported image type', { status: 415 })
  }
  return new NextResponse(data, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': mime!,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    }
  })
}
