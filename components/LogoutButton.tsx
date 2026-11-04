'use client'

import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { useI18n } from '@/lib/i18n/I18nProvider'
import { createClient } from '@/utils/supabase/client'

export default function LogoutButton({
  compact = false,
  localOnly = false
}: {
  compact?: boolean
  localOnly?: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const { t } = useI18n()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const handleLogout = async () => {
    setIsLoggingOut(true)
    try {
      await supabase.auth.signOut({ scope: localOnly ? 'local' : 'global' })
      router.push('/login')
      router.refresh() // Refresh to clear any cached Server Component data
    } catch (error) {
      console.error('Lỗi đăng xuất:', error)
      setIsLoggingOut(false)
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={isLoggingOut}
      aria-label={isLoggingOut ? t('processing') : t('logout')}
      title={compact ? t('logout') : undefined}
      className='flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-secondary hover:bg-neutral hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary disabled:opacity-50'>
      <LogOut className='size-5 shrink-0' aria-hidden='true' />
      <span className={compact ? 'sr-only' : ''}>
        {isLoggingOut ? t('processing') : t('logout')}
      </span>
    </button>
  )
}
