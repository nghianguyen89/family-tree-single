import { cookies } from 'next/headers'

import {
  getLocale,
  getMessages,
  Locale,
  TranslationKey,
  TranslationValues
} from './messages'

export async function getServerLocale(): Promise<Locale> {
  const cookieStore = await cookies()
  return getLocale(cookieStore.get('locale')?.value)
}

export async function getServerTranslations() {
  const locale = await getServerLocale()
  const dictionary = getMessages(locale)

  return {
    locale,
    dictionary,
    t: (key: TranslationKey, values?: TranslationValues) => {
      let value: string = dictionary[key]
      if (values) {
        Object.entries(values).forEach(([name, replacement]) => {
          value = value.replace(`{${name}}`, String(replacement))
        })
      }
      return value
    }
  }
}
