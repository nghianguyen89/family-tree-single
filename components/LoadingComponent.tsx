'use client'

import { Loader2 } from 'lucide-react'

import { useI18n } from '@/lib/i18n/I18nProvider'

export default function LoadingComponent() {
  const { t } = useI18n()
  return (
    <main className='mx-auto flex max-w-5xl flex-1 flex-col items-center justify-center overflow-auto bg-stone-50/50 p-4'>
      <div className='flex flex-col items-center justify-center space-y-4'>
        <div className='relative'>
          <div className='absolute inset-0 animate-pulse rounded-full bg-amber-200/50 blur-xl'></div>
          <div className='relative rounded-2xl border border-stone-100 bg-surface p-4'>
            <Loader2 className='size-8 animate-spin text-amber-600' />
          </div>
        </div>
        <p className='animate-pulse font-medium text-stone-500'>
          {t('loadingFamilyTree')}
        </p>
      </div>
    </main>
  )
}
