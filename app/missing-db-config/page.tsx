'use client'

import { motion } from 'framer-motion'
import { ArrowLeft, Database, Settings, Terminal } from 'lucide-react'
import Link from 'next/link'

import Footer from '@/components/Footer'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import ThemeToggle from '@/components/ThemeToggle'
import { useI18n } from '@/lib/i18n/I18nProvider'

export default function MissingDBConfigPage() {
  const { t } = useI18n()

  return (
    <div className='relative flex min-h-screen flex-col overflow-hidden bg-neutral text-sm select-none selection:bg-amber-200 selection:text-amber-900'>
      {/* Decorative background grid and blurs */}
      <div className='pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-size-[24px_24px]'></div>
      <div className='pointer-events-none absolute inset-x-0 top-0 flex h-screen justify-center overflow-hidden'>
        <div className='absolute top-[-10%] right-[-5%] h-[50vw] max-h-[600px] w-[50vw] max-w-[600px] rounded-full bg-red-300/20 mix-blend-multiply blur-[100px]' />
        <div className='absolute bottom-[0%] left-[-10%] h-[60vw] max-h-[800px] w-[60vw] max-w-[800px] rounded-full bg-amber-200/20 mix-blend-multiply blur-[120px]' />
      </div>

      <div className='absolute top-6 right-6 z-20 flex items-center gap-2'>
        <ThemeToggle />
        <LanguageSwitcher />
      </div>

      <div className='relative z-10 flex w-full flex-1 items-center justify-center px-4 py-12'>
        <motion.div
          className='relative w-full max-w-2xl overflow-hidden rounded-3xl border border-red-100 bg-surface p-8 sm:p-10'
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5 }}>
          <div className='mb-6 flex items-center gap-4'>
            <div className='rounded-2xl bg-red-50 p-4 text-red-600'>
              <Database className='size-8' />
            </div>
            <div>
              <h2 className='text-2xl font-semibold text-stone-900 sm:text-3xl'>
                {t('dbMissingTitle')}
              </h2>
              <p className='text-sm font-medium text-stone-500'>
                {t('dbMissingDescription')}
              </p>
            </div>
          </div>

          <div className='space-y-6'>
            {
              <p
                role='alert'
                className='rounded-xl border border-border bg-neutral p-4 text-sm text-error'>
                {t('deploymentConfigBlocked')}
              </p>
            }
            <div className='rounded-2xl border border-stone-200 bg-stone-50 p-6'>
              <h3 className='mb-4 flex items-center gap-2 font-semibold text-stone-900'>
                <Settings className='size-5 text-stone-500' />
                {t('troubleshooting')}
              </h3>

              <ol className='list-inside list-decimal space-y-4 text-sm text-stone-600'>
                <li className='leading-relaxed'>{t('checkFamilyConfig')}</li>
                <li className='leading-relaxed'>{t('checkProjectBinding')}</li>
                <li className='leading-relaxed'>
                  {t('signInTo')}{' '}
                  <a
                    href='https://supabase.com/dashboard/project/_/settings/api-keys'
                    target='_blank'
                    rel='noopener noreferrer'
                    className='font-medium text-amber-600 hover:underline'>
                    Supabase Dashboard
                  </a>
                  .
                </li>
                <li className='leading-relaxed'>{t('getKeys')}</li>
                <li className='leading-relaxed'>{t('createEnv')}</li>
                <li className='leading-relaxed'>
                  {t('addConfig')}
                  <div className='mt-3 flex items-start gap-3 overflow-x-auto rounded-xl bg-stone-900 p-4 font-mono text-sm text-stone-100'>
                    <Terminal className='mt-0.5 size-5 shrink-0 text-stone-400' />
                    <pre>
                      <code>
                        {`SITE_NAME=Gia Phả
APP_URL=https://your-family.example
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your_supabase_anon_key`}
                      </code>
                    </pre>
                  </div>
                </li>
                <li className='leading-relaxed'>
                  {t('restartServer')} <code>npm run dev</code> ({t('orBunDev')}
                  ).
                </li>
              </ol>
            </div>

            <div className='flex justify-center pt-2'>
              <Link
                href='/'
                className='rounded-xl bg-amber-500 px-6 py-3 font-medium text-white shadow-sm transition-colors hover:bg-amber-600'>
                {t('reloadAfterConfig')}
              </Link>
            </div>
          </div>
        </motion.div>
      </div>

      <Link
        href='/'
        className='absolute top-6 left-6 z-20 flex items-center gap-2 rounded-full border border-stone-200 bg-surface/60 px-5 py-2.5 text-sm font-medium text-stone-500 transition-all duration-300 hover:border-stone-300 hover:text-stone-900'>
        <ArrowLeft className='size-4' />
        {t('home')}
      </Link>

      <Footer className='relative z-10 mt-auto border-none bg-transparent' />
    </div>
  )
}
