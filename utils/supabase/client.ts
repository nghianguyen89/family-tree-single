import { createBrowserClient } from '@supabase/ssr'

import { getDeploymentConfig } from '@/utils/deployment'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY

export const createClient = () => {
  getDeploymentConfig()

  return createBrowserClient(supabaseUrl!, supabaseKey!)
}
