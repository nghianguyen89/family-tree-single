'use client'

import { Moon, Sun } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'

import { useI18n } from '@/lib/i18n/I18nProvider'
import { resolveTheme, THEME_STORAGE_KEY } from '@/utils/theme'

export default function ThemeToggle() {
  const { locale } = useI18n()
  const selected = useRef<string | null>(null)
  const label =
    locale === 'vi' ? 'Chuyển sáng / tối' : 'Toggle light / dark mode'

  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => {
      try {
        selected.current = localStorage.getItem(THEME_STORAGE_KEY)
      } catch {}
      document.documentElement.dataset.theme = resolveTheme(
        selected.current,
        media.matches
      )
    }
    const storageChanged = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) sync()
    }
    sync()
    media.addEventListener('change', sync)
    window.addEventListener('storage', storageChanged)
    return () => {
      media.removeEventListener('change', sync)
      window.removeEventListener('storage', storageChanged)
    }
  }, [])

  const toggle = () => {
    const next =
      document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    selected.current = next
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {}
  }

  return (
    <button
      type='button'
      onClick={toggle}
      aria-label={label}
      title={label}
      className='inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface/70 text-secondary transition-colors hover:bg-neutral hover:text-primary'>
      <Moon className='theme-icon-moon size-4' aria-hidden='true' />
      <Sun className='theme-icon-sun size-4' aria-hidden='true' />
    </button>
  )
}
