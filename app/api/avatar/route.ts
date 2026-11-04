import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { getAvatarStoragePath } from '@/utils/avatar'
import { downloadedImageMime } from '@/utils/image-response'
import { createClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const requestedPath = new URL(request.url).searchParams.get('path')
  const path = getAvatarStoragePath(requestedPath)

  if (!path || path.length > 512 || path.includes('..')) {
    return new NextResponse('Invalid avatar path', { status: 400 })
  }

  const supabase = createClient(await cookies())
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.is_active) return new NextResponse('Forbidden', { status: 403 })

  const { data, error } = await supabase.storage.from('avatars').download(path)

  if (error || !data) return new NextResponse('Not found', { status: 404 })

  const mime = await downloadedImageMime(data)
  if (
    !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime || '')
  ) {
    return new NextResponse('Unsupported avatar type', { status: 415 })
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
