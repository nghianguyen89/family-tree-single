import Image from 'next/image'
import Link from 'next/link'

import config from '@/app/config'
import { MobileDashboardMenuButton } from '@/components/DashboardShell'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import ThemeToggle from '@/components/ThemeToggle'

export default function DashboardHeader() {
  return (
    <header className='sticky top-0 z-30 border-b border-border bg-surface'>
      <div className='mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8'>
        <div className='flex min-w-0 items-center gap-2 md:gap-4'>
          <MobileDashboardMenuButton />
          <Link
            href='/'
            aria-label={config.siteName}
            className='group flex items-center gap-2 sm:gap-3'>
            <div className='relative size-10 shrink-0 overflow-hidden rounded-xl transition-all'>
              <Image
                src={config.logo || '/icon.png'}
                unoptimized
                alt='Logo'
                fill
                className='object-contain'
                sizes='40px'
              />
            </div>
            <h1 className='hidden truncate font-serif text-xl font-semibold text-stone-800 transition-colors group-hover:text-amber-700 sm:block sm:text-2xl'>
              {config.siteName}
            </h1>
          </Link>
        </div>
        <div className='flex shrink-0 items-center gap-2 sm:gap-4'>
          <ThemeToggle />
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  )
}
