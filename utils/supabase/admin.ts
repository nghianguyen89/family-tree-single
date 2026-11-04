import { createClient, SupabaseClient } from '@supabase/supabase-js'

import 'server-only'

import { getDeploymentConfig } from '@/utils/deployment'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export function getAdminSupabase(): SupabaseClient {
  getDeploymentConfig()
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.'
    )
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}
