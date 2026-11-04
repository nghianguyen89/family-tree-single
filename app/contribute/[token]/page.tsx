import type { Metadata } from 'next'

import PublicIntakeForm from '@/components/intake/PublicIntakeForm'
import ThemeToggle from '@/components/ThemeToggle'
import { intakeMessages } from '@/lib/i18n/intake'
import { getServerLocale } from '@/lib/i18n/server'
import { IntakeOptions } from '@/types/intake'
import { INTAKE_TOKEN } from '@/utils/intake'
import { getPublicIntakeClient } from '@/utils/supabase/public-intake'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Khai thông tin gia phả',
  robots: { index: false, follow: false },
  referrer: 'no-referrer'
}

export default async function ContributePage({
  params
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const text = intakeMessages[await getServerLocale()]
  let options: IntakeOptions | null = null
  let message: string = text.unavailable
  if (INTAKE_TOKEN.test(token)) {
    try {
      const { data, error } = await getPublicIntakeClient().rpc(
        'get_family_intake_options',
        { link_token: token }
      )
      if (error) message = text.error
      else options = data as IntakeOptions | null
    } catch {
      message = text.error
    }
  }
  return (
    <main className='min-h-screen bg-neutral px-4 py-8 font-sans text-primary sm:px-6'>
      <div className='mx-auto max-w-3xl space-y-6'>
        <div className='flex justify-end'>
          <ThemeToggle />
        </div>
        <header className='space-y-2'>
          <h1 className='font-serif text-3xl font-semibold'>{text.title}</h1>
          <p className='text-sm text-secondary'>{text.description}</p>
        </header>
        {options ? (
          <PublicIntakeForm token={token} options={options} />
        ) : (
          <p
            role='alert'
            className='rounded-xl border border-border bg-surface p-6 text-sm text-secondary'>
            {message}
          </p>
        )}
      </div>
    </main>
  )
}
