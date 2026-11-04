import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { deploymentError } from '@/utils/deployment'
import { isSharedViewerPath } from '@/utils/shared-viewer'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY

export async function updateSession(request: NextRequest) {
  // If env vars are missing, we cannot create a supabase client
  if (deploymentError() || !supabaseUrl || !supabaseKey) {
    if (request.nextUrl.pathname !== '/missing-db-config') {
      const url = request.nextUrl.clone()
      url.pathname = '/missing-db-config'
      return NextResponse.redirect(url)
    }
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({
    request
  })

  const supabase = createServerClient(supabaseUrl!, supabaseKey!, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        supabaseResponse = NextResponse.next({
          request
        })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        )
      }
    }
  })

  // Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with cross-browser cookies across mobile browsers.
  // https://supabase.com/docs/guides/auth/server-side/nextjs

  const {
    data: { user }
  } = await supabase.auth.getUser()

  // Protected routes
  const protectedPaths = ['/dashboard']
  const isProtectedPath = protectedPaths.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  )

  const isLoginPage = request.nextUrl.pathname.startsWith('/login')

  // Check if DB schema is initialized by checking if profiles table exists
  if (isProtectedPath || isLoginPage) {
    const { error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .limit(1)

    if (
      profileError &&
      (profileError.code === 'PGRST205' || profileError.code === '42P01')
    ) {
      const url = request.nextUrl.clone()
      url.pathname = '/setup'
      return NextResponse.redirect(url)
    }
  }

  if (isProtectedPath && !user) {
    // no user, potentially respond by redirecting the user to the login page
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (isProtectedPath && user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    if (
      profile?.is_shared_viewer &&
      !isSharedViewerPath(request.nextUrl.pathname)
    ) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      url.search = ''
      const response = NextResponse.redirect(url)
      supabaseResponse.cookies
        .getAll()
        .forEach((cookie) => response.cookies.set(cookie))
      return response
    }
  }

  // Redirect users who are already logged in away from the login page
  if (isLoginPage && user) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
