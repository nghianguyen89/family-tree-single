import 'server-only'

import config from '@/app/config'
import type {
  ContentEntry,
  ContentImage,
  ContentKind,
  HomeSettings
} from '@/types/content'
import { getSupabase } from '@/utils/supabase/queries'

export const defaultHomeSettings: HomeSettings = {
  id: 1,
  title: config.siteName,
  subtitle: 'Gìn giữ cội nguồn, kết nối các thế hệ.',
  origin: '',
  origin_previous: '',
  introduction: '',
  contact: '',
  cover_image_id: null,
  section_order: ['announcements', 'articles', 'albums'],
  revision: 1
}

export async function getHomeSettings() {
  const db = await getSupabase()
  const { data, error } = await db
    .from('home_settings')
    .select('*')
    .eq('id', 1)
    .single()
  return {
    settings: (data || defaultHomeSettings) as HomeSettings,
    error: !!error
  }
}

export async function getContentFeed(
  kind?: ContentKind,
  page = 0,
  limit = 12,
  home = false
) {
  const db = await getSupabase()
  const now = new Date().toISOString()
  let query = db
    .from('home_content')
    .select('*', { count: 'exact' })
    .eq('status', 'published')
    .is('deleted_at', null)
    .lte('publish_at', now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
  if (kind) query = query.eq('kind', kind)
  if (home && kind === 'announcement') {
    query = query
      .or(`event_start.gte.${now},event_end.gte.${now}`)
      .order('is_featured', { ascending: false })
      .order('event_start')
  } else if (home) query = query.order('is_featured', { ascending: false })
  const { data, count, error } = await query
    .order('publish_at', { ascending: false })
    .order('id')
    .range(page * limit, page * limit + limit - 1)
  return {
    entries: (data || []) as ContentEntry[],
    count: count || 0,
    error: !!error
  }
}

export async function getContentEntry(id: string, editorial = false) {
  const db = await getSupabase()
  let query = db.from('home_content').select('*').eq('id', id)
  if (!editorial) {
    const now = new Date().toISOString()
    query = query
      .eq('status', 'published')
      .is('deleted_at', null)
      .lte('publish_at', now)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
  }
  const { data } = await query.maybeSingle()
  return data as ContentEntry | null
}

export async function getContentImages(entryId: string) {
  const db = await getSupabase()
  const { data, error } = await db
    .from('home_content_images')
    .select('*')
    .eq('entry_id', entryId)
    .order('position')
    .order('id')
    .limit(100)
  return { images: (data || []) as ContentImage[], error: !!error }
}

export async function getEntryCover(entryId: string) {
  const db = await getSupabase()
  const { data } = await db
    .from('home_content_images')
    .select('*')
    .eq('entry_id', entryId)
    .order('position')
    .order('id')
    .limit(1)
    .maybeSingle()
  return data as ContentImage | null
}
