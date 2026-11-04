import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { notifyAdminOfPendingUser } from '@/utils/approval-notification'
import { getDeploymentConfig } from '@/utils/deployment'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request) {
  let appUrl: string
  try {
    appUrl = getDeploymentConfig().appUrl
  } catch {
    return NextResponse.json(
      { error: 'Deployment configuration is invalid.' },
      { status: 503 }
    )
  }
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const authError = requestUrl.searchParams.get('error')

  if (authError) {
    return NextResponse.redirect(
      new URL('/login?error=auth_callback_failed', appUrl)
    )
  }

  if (code) {
    const supabase = createClient(await cookies())
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      return NextResponse.redirect(
        new URL('/login?error=auth_callback_failed', appUrl)
      )
    }

    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (user?.email) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, is_active')
        .eq('id', user.id)
        .maybeSingle()

      if (profile?.role === 'member' && !profile.is_active) {
        try {
          await notifyAdminOfPendingUser({ id: user.id, email: user.email })
        } catch (error) {
          console.error('Cannot notify administrators of pending user:', error)
        }
      }
    }
  }

  return NextResponse.redirect(new URL('/dashboard', appUrl))
}
