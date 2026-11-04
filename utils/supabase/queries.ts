import { cookies } from 'next/headers'
import { cache } from 'react'

import { Profile } from '@/types'
import { createClient } from '@/utils/supabase/server'

// Hàm này được cache lại để đảm bảo chỉ tạo 1 Supabase Client duy nhất cho mỗi request
export const getSupabase = cache(async () => {
  const cookieStore = await cookies()
  return createClient(cookieStore)
})

export const getUser = cache(async () => {
  const supabase = await getSupabase()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  return user
})

export const getProfile = cache(async (userId?: string) => {
  let id = userId
  if (!id) {
    const user = await getUser()
    if (!user) return null
    id = user.id
  }

  const supabase = await getSupabase()
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error(`Cannot load profile for user ${id}:`, error.message)
  }

  return profile as Profile | null
})

export const getIsAdmin = cache(async () => {
  const profile = await getProfile()
  return profile?.role === 'admin' && profile.is_active
})
