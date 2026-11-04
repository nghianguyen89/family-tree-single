'use server'

import { revalidatePath } from 'next/cache'

import type { MediaAsset } from '@/types/media'
import { CONTENT_UUID } from '@/utils/content'
import { getAdminSupabase } from '@/utils/supabase/admin'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

async function editorClient() {
  const profile = await getProfile()
  if (!profile?.is_active || !['admin', 'editor'].includes(profile.role))
    throw new Error('Access denied')
  return getSupabase()
}
const fields =
  'id,title,description,event_date,width,height,library_visible,created_at,created_by'
export async function listMediaAssets(search = '', page = 0) {
  if (!(await getProfile())?.is_active) throw new Error('Access denied')
  const db = await getSupabase()
  let query = db.from('media_assets').select(fields, { count: 'exact' })
  const term = search
    .replace(/[%_\\]/g, '')
    .trim()
    .slice(0, 100)
  if (term) query = query.ilike('title', `%${term}%`)
  const index = Math.max(0, Math.min(10000, Math.floor(page)))
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .order('id')
    .range(index * 36, index * 36 + 35)
  return {
    assets: (data || []) as MediaAsset[],
    count: count || 0,
    error: !!error
  }
}
export async function attachMediaAsset(
  assetId: string,
  entryId: string | null
) {
  const db = await editorClient()
  if (
    !CONTENT_UUID.test(assetId) ||
    (entryId !== null && !CONTENT_UUID.test(entryId))
  )
    return { error: 'invalid' }
  const { data, error } = await db.rpc('attach_media_asset', {
    asset: assetId,
    entry: entryId
  })
  if (error || !data) return { error: 'attach' }
  revalidatePath('/dashboard/content', 'layout')
  revalidatePath('/')
  revalidatePath('/news', 'layout')
  return { image: data }
}
export async function updateMediaAsset(
  assetId: string,
  value: Pick<
    MediaAsset,
    'title' | 'description' | 'event_date' | 'library_visible'
  >
) {
  const db = await editorClient()
  if (
    !CONTENT_UUID.test(assetId) ||
    !value.title.trim() ||
    value.title.length > 300 ||
    value.description.length > 4000 ||
    typeof value.library_visible !== 'boolean' ||
    (value.event_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value.event_date))
  )
    return { error: 'invalid' }
  const { data, error } = await db
    .from('media_assets')
    .update(value)
    .eq('id', assetId)
    .select('id')
    .maybeSingle()
  if (error || !data) return { error: 'save' }
  revalidatePath('/dashboard/gallery')
  return { success: true }
}
export async function removeMediaAsset(assetId: string) {
  const db = await editorClient()
  if (!CONTENT_UUID.test(assetId)) return { error: 'invalid' }
  const { data, error } = await db.rpc('remove_media_asset', { asset: assetId })
  if (error) return { error: error.code === '23503' ? 'inUse' : 'remove' }
  const file = data?.[0]
  if (!file) return { error: 'remove' }
  // Legacy gallery files keep their original bucket; cleanup is authorized by
  // the RPC above, including the reference check, before using the service client.
  try {
    await getAdminSupabase()
      .storage.from(file.storage_bucket)
      .remove([file.storage_path])
  } catch {
    /* Metadata removal still revokes image access. */
  }
  revalidatePath('/dashboard/gallery')
  return { success: true }
}
