'use server'

import { revalidatePath } from 'next/cache'

import { validSharedPin } from '@/utils/shared-viewer'
import { getAdminSupabase } from '@/utils/supabase/admin'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

const sharedEmail = 'shared-viewer@family-tree.invalid'

export async function signInSharedViewer(pin: string) {
  if (!validSharedPin(pin)) return { error: 'invalidPin' as const }
  const supabase = await getSupabase()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: sharedEmail,
    password: pin
  })
  if (error || !data.user) return { error: 'loginFailed' as const }
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_shared_viewer,is_active,role,person_id')
    .eq('id', data.user.id)
    .single()
  if (
    !profile?.is_shared_viewer ||
    !profile.is_active ||
    profile.role !== 'member' ||
    profile.person_id
  ) {
    await supabase.auth.signOut({ scope: 'local' })
    return { error: 'loginFailed' as const }
  }
  return { success: true as const }
}

export async function saveSharedViewer(formData: FormData) {
  const profile = await getProfile()
  if (
    profile?.role !== 'admin' ||
    !profile.is_active ||
    profile.is_shared_viewer
  )
    return { error: 'permission' as const }
  const pin = formData.get('pin')
  const enabled = formData.get('enabled') === 'on'
  if (typeof pin !== 'string' || (pin !== '' && !validSharedPin(pin)))
    return { error: 'invalidPin' as const }
  const supabase = await getSupabase()
  const { data: existing, error: queryError } = await supabase
    .from('profiles')
    .select('id,is_active')
    .eq('is_shared_viewer', true)
    .maybeSingle()
  if (queryError) return { error: 'migration' as const }
  if (!existing && !pin) return { error: 'invalidPin' as const }

  const admin = getAdminSupabase()
  let userId = existing?.id
  const setActive = (id: string, active: boolean) =>
    admin
      .from('profiles')
      .update({ is_active: active })
      .eq('id', id)
      .eq('is_shared_viewer', true)
      .select('id')
      .single()
  if (existing && (pin || !enabled)) {
    const { error } = await setActive(existing.id, false)
    if (error) return { error: 'setupFailed' as const }
    revalidatePath('/dashboard/users')
  }
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: sharedEmail,
      password: pin,
      email_confirm: true
    })
    if (error || !data.user) return { error: 'setupFailed' as const }
    userId = data.user.id
  } else if (pin) {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password: pin
    })
    if (error) return { error: 'setupFailed' as const }
  }
  if (existing && (pin || !enabled)) {
    const { error } = await supabase.rpc('revoke_shared_viewer_sessions', {
      p_user_id: userId
    })
    if (error) return { error: 'sessionsFailed' as const }
  }
  // Reactivate only after old sessions are gone; failures above leave it locked.
  const { error: updateError } = await setActive(userId, enabled)
  if (updateError) return { error: 'setupFailed' as const }
  revalidatePath('/dashboard/users')
  return { success: true as const }
}
