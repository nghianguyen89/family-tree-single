'use server'

import { createHash, randomBytes } from 'node:crypto'

import { revalidatePath } from 'next/cache'

import { IntakePayload, IntakeSubmission } from '@/types/intake'
import { UUID, validateIntake } from '@/utils/intake'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

async function editorClient() {
  const profile = await getProfile()
  if (!profile?.is_active || !['admin', 'editor'].includes(profile.role))
    throw new Error('Access denied')
  return getSupabase()
}

export async function createIntakeLink(
  title: string,
  rootId: string,
  days: number
) {
  const supabase = await editorClient()
  if (
    !title.trim() ||
    title.length > 200 ||
    !UUID.test(rootId) ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 365
  )
    return { error: 'Invalid link details' }
  const token = randomBytes(32).toString('hex')
  const { error } = await supabase.from('family_intake_links').insert({
    title: title.trim(),
    root_person_id: rootId,
    expires_at: new Date(Date.now() + days * 86400000).toISOString(),
    share_token: token,
    token_hash: createHash('md5').update(token).digest('hex')
  })
  if (error)
    return {
      error: ['PGRST205', 'PGRST204', '42703'].includes(error.code)
        ? 'migration'
        : error.message
    }
  revalidatePath('/dashboard/intake')
  return { token }
}

export async function disableIntakeLink(id: string) {
  const supabase = await editorClient()
  if (!UUID.test(id)) return { error: 'Invalid link' }
  const { error } = await supabase
    .from('family_intake_links')
    .update({ is_active: false })
    .eq('id', id)
    .select('id')
    .single()
  if (error) return { error: error.message }
  revalidatePath('/dashboard/intake')
  return { success: true }
}

export async function deleteIntakeLink(id: string) {
  const supabase = await editorClient()
  if (!UUID.test(id)) return { error: 'Invalid link' }
  const { error } = await supabase
    .from('family_intake_links')
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .single()
  if (error) return { error: error.message }
  revalidatePath('/dashboard/intake')
  return { success: true }
}

// Legacy links stored only a hash. Replace their token once, without resetting quotas.
export async function replaceLegacyIntakeLink(id: string) {
  const supabase = await editorClient()
  if (!UUID.test(id)) return { error: 'Invalid link' }
  const token = randomBytes(32).toString('hex')
  const { error } = await supabase
    .from('family_intake_links')
    .update({
      share_token: token,
      token_hash: createHash('md5').update(token).digest('hex')
    })
    .eq('id', id)
    .eq('is_active', true)
    .is('deleted_at', null)
    .is('share_token', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .single()
  if (error) return { error: error.message }
  revalidatePath('/dashboard/intake')
  return { token }
}

export async function getIntakeSubmissions(status: string, page = 0) {
  const supabase = await editorClient()
  if (
    !['all', 'pending', 'needs_info', 'approved', 'rejected'].includes(
      status
    ) ||
    !Number.isInteger(page) ||
    page < 0 ||
    page > 10000
  )
    return { error: 'Invalid filter', rows: [], count: 0 }
  let query = supabase
    .from('family_intake_submissions')
    .select(
      'id,link_id,payload,reviewed_payload,status,reviewer_note,created_at,reviewed_at,approved_person_ids',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .order('id')
    .range(page * 20, page * 20 + 19)
  if (status !== 'all') query = query.eq('status', status)
  const { data, error, count } = await query
  return {
    rows: (data || []) as IntakeSubmission[],
    count: count || 0,
    ...(error
      ? { error: error.code === 'PGRST205' ? 'migration' : error.message }
      : {})
  }
}

export async function reviewIntakeSubmission(
  id: string,
  decision: 'approved' | 'rejected' | 'needs_info',
  payload: IntakePayload,
  note: string
) {
  const supabase = await editorClient()
  if (
    !UUID.test(id) ||
    !['approved', 'rejected', 'needs_info'].includes(decision) ||
    typeof note !== 'string' ||
    note.length > 2000 ||
    (decision !== 'approved' && !note.trim()) ||
    (decision === 'approved' && !validateIntake(payload))
  )
    return { error: 'Invalid review details' }
  const { error } = await supabase.rpc('review_family_intake', {
    submission_id: id,
    decision,
    review_payload: payload,
    review_note: note
  })
  if (error) return { error: error.message }
  revalidatePath('/dashboard', 'layout')
  return { success: true }
}

export async function deleteIntakeSubmission(id: string) {
  const supabase = await editorClient()
  if (!UUID.test(id)) return { error: 'Invalid submission' }
  const { error } = await supabase
    .from('family_intake_submissions')
    .delete()
    .eq('id', id)
    .in('status', ['pending', 'needs_info'])
    .select('id')
    .single()
  if (error) return { error: error.message }
  revalidatePath('/dashboard/intake')
  return { success: true }
}
