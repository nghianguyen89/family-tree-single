'use server'

import { revalidatePath } from 'next/cache'

import { getServerTranslations } from '@/lib/i18n/server'
import { UserRole } from '@/types'
import { UUID } from '@/utils/intake'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

export async function linkUserPerson(userId: string, personId: string | null) {
  const profile = await getProfile()
  if (profile?.role !== 'admin' || !profile.is_active)
    return { error: 'permission' }
  if (
    typeof userId !== 'string' ||
    !UUID.test(userId) ||
    (personId !== null &&
      (typeof personId !== 'string' || !UUID.test(personId)))
  )
    return { error: 'invalid' }

  const supabase = await getSupabase()
  const { error } = await supabase.rpc('set_user_person', {
    p_user_id: userId,
    p_person_id: personId
  })
  if (error) {
    if (['PGRST202', 'PGRST204', '42703', '42883'].includes(error.code))
      return { error: 'migration' }
    if (error.code === '23505') return { error: 'alreadyLinked' }
    return { error: 'saveFailed' }
  }
  revalidatePath('/dashboard', 'layout')
  return { success: true as const }
}

export async function changeUserRole(userId: string, newRole: UserRole) {
  const supabase = await getSupabase()
  const { error } = await supabase.rpc('set_user_role', {
    target_user_id: userId,
    new_role: newRole
  })

  if (error) {
    console.error('Failed to change user role:', error)
    return { error: error.message }
  }

  revalidatePath('/dashboard/users')
  return { success: true }
}

export async function deleteUser(userId: string) {
  const supabase = await getSupabase()
  const { error } = await supabase.rpc('delete_user', {
    target_user_id: userId
  })

  if (error) {
    console.error('Failed to delete user:', error)
    return { error: error.message }
  }

  revalidatePath('/dashboard/users')
  return { success: true }
}

export async function adminCreateUser(formData: FormData) {
  const { t } = await getServerTranslations()
  const email = formData.get('email')?.toString()
  const password = formData.get('password')?.toString()
  const role = formData.get('role')?.toString() || 'member'

  if (role !== 'admin' && role !== 'editor' && role !== 'member') {
    return { error: t('invalidUserRole') }
  }

  const isActiveStr = formData.get('is_active')?.toString()
  const isActive = isActiveStr === 'false' ? false : true

  if (!email || !password) {
    return { error: t('emailPasswordRequired') }
  }

  const supabase = await getSupabase()

  const { error } = await supabase.rpc('admin_create_user', {
    new_email: email,
    new_password: password,
    new_role: role,
    new_active: isActive
  })

  if (error) {
    console.error('Failed to create user:', error)
    return { error: error.message }
  }

  revalidatePath('/dashboard/users')
  return { success: true }
}

export async function toggleUserStatus(userId: string, newStatus: boolean) {
  const supabase = await getSupabase()
  const { error } = await supabase.rpc('set_user_active_status', {
    target_user_id: userId,
    new_status: newStatus
  })

  if (error) {
    console.error('Failed to change user status:', error)
    return { error: error.message }
  }

  revalidatePath('/dashboard/users')
  return { success: true }
}
