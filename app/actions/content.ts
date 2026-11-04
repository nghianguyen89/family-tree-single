'use server'

import { revalidatePath } from 'next/cache'

import type { ContentInput, HomeSettings } from '@/types/content'
import {
  CONTENT_UUID,
  validateContent,
  validateHomeSettings
} from '@/utils/content'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

async function editorClient() {
  const profile = await getProfile()
  if (!profile?.is_active || !['admin', 'editor'].includes(profile.role))
    throw new Error('Access denied')
  return getSupabase()
}
function refreshContent() {
  revalidatePath('/')
  revalidatePath('/news', 'layout')
  revalidatePath('/dashboard/content', 'layout')
}
const failed = { error: 'save' as const }

export async function saveContent(
  input: ContentInput,
  id: string | null,
  revision: number
) {
  const db = await editorClient()
  if (
    !validateContent(input) ||
    (id !== null && !CONTENT_UUID.test(id)) ||
    !Number.isInteger(revision) ||
    revision < 1
  )
    return { error: 'invalid' }
  const {
    kind,
    title,
    summary,
    body,
    category,
    status,
    visibility,
    is_featured,
    publish_at,
    expires_at,
    event_start,
    event_end,
    location
  } = input
  const value = {
    kind,
    title: title.trim(),
    summary: summary.trim(),
    body,
    category,
    status,
    visibility,
    is_featured,
    publish_at,
    expires_at,
    event_start,
    event_end,
    location: location.trim()
  }
  const query = id
    ? db
        .from('home_content')
        .update(value)
        .eq('id', id)
        .eq('revision', revision)
        .is('deleted_at', null)
    : db.from('home_content').insert(value)
  const { data, error } = await query
    .select('id,revision,updated_at')
    .maybeSingle()
  if (error) return failed
  if (!data) return { error: 'conflict' }
  refreshContent()
  return {
    id: data.id as string,
    revision: data.revision as number,
    updated_at: data.updated_at as string
  }
}

export async function trashContent(
  id: string,
  revision: number,
  restore = false
) {
  const db = await editorClient()
  if (
    !CONTENT_UUID.test(id) ||
    !Number.isInteger(revision) ||
    revision < 1 ||
    typeof restore !== 'boolean'
  )
    return { error: 'invalid' }
  let query = db
    .from('home_content')
    .update({
      deleted_at: restore ? null : new Date().toISOString(),
      ...(restore ? { status: 'draft' } : {})
    })
    .eq('id', id)
    .eq('revision', revision)
  query = restore
    ? query.not('deleted_at', 'is', null)
    : query.is('deleted_at', null)
  const { data, error } = await query.select('id').maybeSingle()
  if (error) return failed
  if (!data) return { error: 'conflict' }
  refreshContent()
  return { success: true }
}

export async function saveHomeSettings(input: HomeSettings) {
  const db = await editorClient()
  if (
    !validateHomeSettings(input) ||
    !Number.isInteger(input.revision) ||
    input.revision < 1
  )
    return { error: 'invalid' }
  const {
    title,
    subtitle,
    origin,
    origin_previous,
    introduction,
    contact,
    cover_image_id,
    section_order
  } = input
  const { data, error } = await db
    .from('home_settings')
    .update({
      title: title.trim(),
      subtitle,
      origin,
      origin_previous: origin_previous ?? '',
      introduction,
      contact,
      cover_image_id,
      section_order
    })
    .eq('id', 1)
    .eq('revision', input.revision)
    .select('revision')
    .maybeSingle()
  if (error)
    return ['PGRST204', '42703'].includes(error.code)
      ? { error: 'migration' }
      : failed
  if (!data) return { error: 'conflict' }
  refreshContent()
  return { revision: data.revision as number }
}

export async function updateContentImage(
  id: string,
  alt: string,
  caption: string,
  position: number
) {
  const db = await editorClient()
  if (
    !CONTENT_UUID.test(id) ||
    typeof alt !== 'string' ||
    !alt.trim() ||
    alt.length > 300 ||
    typeof caption !== 'string' ||
    caption.length > 1000 ||
    !Number.isInteger(position) ||
    position < 0 ||
    position > 10000
  )
    return { error: 'invalid' }
  const { data, error } = await db
    .from('home_content_images')
    .update({ alt: alt.trim(), caption, position })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error || !data) return failed
  refreshContent()
  return { success: true }
}

export async function removeContentImage(id: string) {
  const db = await editorClient()
  if (!CONTENT_UUID.test(id)) return { error: 'invalid' }
  const { data, error } = await db
    .from('home_content_images')
    .delete()
    .eq('id', id)
    .select('storage_path')
    .maybeSingle()
  if (error || !data) return failed
  // Detach this placement. The shared asset/file can still be used elsewhere.
  refreshContent()
  return { success: true }
}
