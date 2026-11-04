import 'server-only'

import { notFound } from 'next/navigation'

import { getAdminSupabase } from './admin'
import { getProfile } from './queries'

export async function requireContentEditor() {
  const profile = await getProfile()
  if (!profile?.is_active || !['admin', 'editor'].includes(profile.role))
    notFound()
  return profile
}

export async function getContentEditorName(
  userId: string | null
): Promise<string | null> {
  await requireContentEditor()
  if (!userId) return null
  try {
    const { data, error } =
      await getAdminSupabase().auth.admin.getUserById(userId)
    if (error || !data.user) return null
    const name =
      data.user.user_metadata?.full_name ||
      data.user.user_metadata?.name ||
      data.user.email
    return typeof name === 'string' ? name.slice(0, 200) : null
  } catch {
    return null
  }
}
