'use client'

import { AlertCircle, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'

import { useI18n } from '@/lib/i18n/I18nProvider'

export default function DashboardError({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { t } = useI18n()

  useEffect(() => {
    console.error('Dashboard error:', error)
  }, [error])

  return (
    <main className='flex flex-1 flex-col items-center justify-center p-4'>
      <div className='w-full max-w-md rounded-3xl border border-stone-200 bg-surface p-8 text-center'>
        <div className='mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-red-50 text-red-500'>
          <AlertCircle className='size-7' />
        </div>
        <h2 className='mb-2 font-serif text-xl font-semibold text-stone-800'>
          {t('pageErrorTitle')}
        </h2>
        <p className='text-sm text-stone-500'>{t('pageErrorDescription')}</p>
        <div className='mt-6 flex flex-wrap justify-center gap-3'>
          <button type='button' onClick={reset} className='btn-primary'>
            <RotateCcw className='size-4' />
            {t('tryAgain')}
          </button>
          <Link href='/dashboard' className='btn'>
            {t('home')}
          </Link>
        </div>
      </div>
    </main>
  )
}
