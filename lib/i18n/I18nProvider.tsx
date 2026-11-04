'use client'

import { createContext, ReactNode, useContext, useMemo, useState } from 'react'

import {
  getLocale,
  getMessages,
  Locale,
  messages,
  TranslationKey,
  TranslationValues
} from './messages'

interface I18nContextValue {
  locale: Locale
  messages: (typeof messages)[Locale]
  setLocale: (locale: Locale) => void
  t: (key: TranslationKey, values?: TranslationValues) => string
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined)

export function I18nProvider({
  children,
  initialLocale
}: {
  children: ReactNode
  initialLocale: Locale
}) {
  const [locale, setLocaleState] = useState(initialLocale)

  const setLocale = (nextLocale: Locale) => {
    document.cookie = `locale=${nextLocale}; path=/; max-age=31536000; samesite=lax`
    setLocaleState(nextLocale)
    document.documentElement.lang = nextLocale
    window.location.reload()
  }

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      messages: getMessages(locale),
      setLocale,
      t: (key, values) => {
        let value: string = getMessages(locale)[key]
        if (values) {
          Object.entries(values).forEach(([name, replacement]) => {
            value = value.replace(`{${name}}`, String(replacement))
          })
        }
        return value
      }
    }),
    [locale]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return context
}

export function getInitialLocale(value?: string | null) {
  return getLocale(value)
}
