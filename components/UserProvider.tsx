'use client'

import { SupabaseClient, User } from '@supabase/supabase-js'
import { createContext, ReactNode, useContext, useMemo } from 'react'

import { Profile } from '@/types'
import { createClient } from '@/utils/supabase/client'

interface UserState {
  user: User | null
  profile: Profile | null
  isAdmin: boolean
  isEditor: boolean
  supabase: SupabaseClient
}

const UserContext = createContext<UserState | undefined>(undefined)

export function UserProvider({
  children,
  user,
  profile
}: {
  children: ReactNode
  user: User | null
  profile: Profile | null
}) {
  const supabase = useMemo(() => createClient(), [])
  const isActive = profile?.is_active === true && !profile.is_shared_viewer
  const isAdmin = isActive && profile?.role === 'admin'
  const isEditor = isActive && (profile?.role === 'editor' || isAdmin)

  return (
    <UserContext.Provider
      value={{ user, profile, isAdmin, isEditor, supabase }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  const context = useContext(UserContext)
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider')
  }
  return context
}
