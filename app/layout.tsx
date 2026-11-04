import type { Metadata } from 'next'
import { Inter, Playfair_Display } from 'next/font/google'

import { I18nProvider } from '@/lib/i18n/I18nProvider'
import { getServerLocale } from '@/lib/i18n/server'
import { themeInitScript } from '@/utils/theme'

import config from './config'

import './globals.css'

const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-inter'
})
const playfair = Playfair_Display({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-playfair'
})
export const metadata: Metadata = {
  title: config.siteName,
  description: config.siteName,
  icons: config.logo ? { icon: config.logo, apple: config.logo } : undefined
}

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await getServerLocale()

  return (
    <html lang={locale} data-theme='light' suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${inter.variable} ${playfair.variable} relative font-sans antialiased`}>
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
      </body>
    </html>
  )
}
