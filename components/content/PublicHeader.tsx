import { BookOpen, Settings2 } from 'lucide-react'
import Link from 'next/link'

import config from '@/app/config'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import ThemeToggle from '@/components/ThemeToggle'
import { contentText } from '@/lib/i18n/content'

export default function PublicHeader({
  title,
  locale,
  active = false,
  editor = false
}: {
  title: string
  locale: string
  active?: boolean
  editor?: boolean
}) {
  const t = contentText(locale)
  return (
    <header className='sticky top-0 z-30 border-b border-border bg-surface'>
      <div className='mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8'>
        <Link href='/' className='flex min-w-0 flex-1 items-center gap-3'>
          {config.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={config.logo}
              alt=''
              width={32}
              height={32}
              className='size-8 shrink-0 rounded-md'
            />
          ) : (
            <BookOpen
              className='size-6 shrink-0 text-tertiary'
              aria-hidden='true'
            />
          )}
          <span className='truncate font-serif text-xl font-semibold text-primary'>
            {title}
          </span>
        </Link>
        <ThemeToggle />
        <div className='flex w-full shrink-0 items-center justify-between gap-2 sm:w-auto sm:justify-end'>
          <LanguageSwitcher />
          {editor && (
            <Link
              href='/dashboard/content'
              className='inline-flex size-10 items-center justify-center rounded-full border border-border text-secondary hover:bg-neutral'
              aria-label={t.manage}
              title={t.manage}>
              <Settings2 className='size-4' />
            </Link>
          )}
          <Link
            href={active ? '/dashboard' : '/login'}
            className='ml-auto rounded-xl bg-primary px-4 py-2 text-sm font-medium text-surface sm:ml-0'>
            {active ? t.tree : t.login}
          </Link>
        </div>
      </div>
    </header>
  )
}
