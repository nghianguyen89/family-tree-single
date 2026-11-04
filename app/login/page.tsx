'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Info, KeyRound, Mail, Shield, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import config from '@/app/config'
import Footer from '@/components/Footer'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import SharedViewerLogin from '@/components/SharedViewerLogin'
import ThemeToggle from '@/components/ThemeToggle'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { sharedViewerMessages } from '@/lib/i18n/shared-viewer'
import { createClient } from '@/utils/supabase/client'

const ssoGuideUrl =
  'https://github.com/nghianguyen89/family-tree-single#khởi-tạo-supabase-và-admin-đầu-tiên'

export default function LoginPage() {
  const { t, locale } = useI18n()
  const sharedText = sharedViewerMessages[locale]
  const [sharedLogin, setSharedLogin] = useState(false)
  const isDemo = config.isDemo
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [isLogin, setIsLogin] = useState(true)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [confirmPassword, setConfirmPassword] = useState('')
  const [ssoError, setSsoError] = useState(false)
  // Fail closed: SSO is hidden until the deployment explicitly enables it.
  const ssoDisabled = process.env.NEXT_PUBLIC_DISABLE_SSO !== 'false'

  const handleOAuthLogin = async (provider: 'google' | 'facebook') => {
    setLoading(true)
    setError(null)
    setSuccessMessage(null)
    setSsoError(false)

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${config.appUrl}/auth/callback`
      }
    })

    if (error) {
      setSsoError(true)
      setError(
        t('oauthNotConfigured', {
          provider: provider === 'google' ? 'Google' : 'Facebook'
        })
      )
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccessMessage(null)
    setSsoError(false)

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password
        })

        if (error) {
          setError(error.message)
        } else {
          router.push('/dashboard')
          router.refresh()
        }
      } else {
        if (password !== confirmPassword) {
          setError(t('passwordMismatch'))
          setLoading(false)
          return
        }

        // 1. Try to sign up
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${config.appUrl}/auth/callback`
          }
        })

        if (error) {
          // Check if error is related to missing database schema/tables
          if (
            error.message.includes('relation') &&
            error.message.includes('does not exist')
          ) {
            router.push('/setup')
            return
          }

          setError(error.message)
        } else {
          if (data.session) {
            router.push('/dashboard')
            router.refresh()
          } else {
            // Support Supabase projects that explicitly disable email confirmation.
            const { data: signInData, error: signInError } =
              await supabase.auth.signInWithPassword({
                email,
                password
              })

            if (!signInError && signInData.session) {
              router.push('/dashboard')
              router.refresh()
            } else {
              setSuccessMessage(t('signupSuccess'))
              setIsLogin(true) // Switch back to login view
              setConfirmPassword('') // clear confirm password
              setPassword('') // clear password
            }
          }
        }
      }
    } catch (err) {
      setError(t('unexpectedError'))
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className='relative flex min-h-screen flex-col overflow-hidden bg-neutral select-none selection:bg-amber-200 selection:text-amber-900'>
      {/* Decorative background grid and blurs */}
      <div className='pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-size-[24px_24px]'></div>
      <div className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle_800px_at_50%_-30%,var(--color-amber-100),transparent)]'></div>

      <div className='pointer-events-none absolute inset-x-0 top-0 flex h-screen justify-center overflow-hidden'>
        <div className='absolute top-[-10%] right-[-5%] h-[50vw] max-h-[600px] w-[50vw] max-w-[600px] rounded-full bg-amber-300/20 mix-blend-multiply blur-[100px]' />
        <div className='absolute bottom-[0%] left-[-10%] h-[60vw] max-h-[800px] w-[60vw] max-w-[800px] rounded-full bg-rose-200/20 mix-blend-multiply blur-[120px]' />
      </div>

      <header className='relative z-20 flex w-full items-center justify-between gap-3 px-4 pt-6 sm:px-6'>
        <Link
          href='/'
          className='group flex shrink-0 items-center gap-2 rounded-full border border-stone-200 bg-surface/60 px-4 py-2.5 text-sm font-medium text-stone-500 transition-all duration-300 hover:border-stone-300 hover:text-stone-900 sm:px-5'>
          <ArrowLeft className='size-4 transition-transform group-hover:-translate-x-1' />
          {t('home')}
        </Link>

        <div className='flex shrink-0 items-center gap-2 sm:gap-3'>
          <ThemeToggle />
          <LanguageSwitcher />
          <Link
            href='/about'
            className='group flex items-center gap-2 rounded-full border border-stone-200 bg-surface/60 px-4 py-2.5 text-sm font-medium text-stone-500 transition-all duration-300 hover:border-stone-300 hover:text-stone-900 sm:px-5'>
            <Info className='size-4 transition-transform group-hover:scale-110' />
            {t('about')}
          </Link>
        </div>
      </header>

      <div className='relative z-10 flex w-full flex-1 items-center justify-center px-4 py-12'>
        <motion.div
          className='relative w-full max-w-md overflow-hidden rounded-3xl border border-surface/80 bg-surface p-8 sm:p-10'
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}>
          <div className='pointer-events-none absolute top-0 right-0 h-32 w-32 rounded-bl-[100px] bg-linear-to-br from-amber-100/50 to-transparent'></div>

          <div className='relative z-10 mb-8 text-center'>
            <Link
              href='/'
              className='mb-5 inline-flex items-center justify-center rounded-2xl bg-surface p-3.5 shadow-sm ring-1 ring-stone-100 transition-all duration-300 hover:scale-105 hover:shadow-md'>
              <Shield className='size-8 text-amber-600' />
            </Link>
            <h2 className='font-serif text-3xl font-semibold text-stone-900 sm:text-4xl'>
              {isLogin ? t('login') : t('signUp')}
            </h2>
            <p className='mt-3 text-sm font-medium text-stone-500'>
              {isLogin ? t('loginDescription') : t('signUpDescription')}
            </p>
            {isDemo && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className='mt-4 rounded-xl border border-amber-200/60 bg-amber-50 p-3'>
                <p className='text-sm font-medium text-amber-800'>
                  {t('demoNotice')}
                </p>
              </motion.div>
            )}
          </div>

          {isLogin && (
            <div className='relative z-10 mb-5 flex flex-wrap gap-2 text-sm'>
              <button
                type='button'
                aria-pressed={!sharedLogin}
                onClick={() => setSharedLogin(false)}
                className={`flex-1 rounded-xl border border-border px-3 py-2 ${!sharedLogin ? 'bg-primary text-surface' : 'bg-surface text-secondary'}`}>
                {sharedText.personal}
              </button>
              <button
                type='button'
                aria-pressed={sharedLogin}
                onClick={() => setSharedLogin(true)}
                className={`flex-1 rounded-xl border border-border px-3 py-2 ${sharedLogin ? 'bg-primary text-surface' : 'bg-surface text-secondary'}`}>
                {sharedText.login}
              </button>
            </div>
          )}
          {isLogin && sharedLogin ? (
            <SharedViewerLogin />
          ) : (
            <form className='relative z-10 space-y-5' onSubmit={handleSubmit}>
              <div className='space-y-4'>
                <div className='relative'>
                  <label
                    htmlFor='email-address'
                    className='mb-1.5 ml-1 block text-sm font-medium text-stone-600'>
                    Email
                  </label>
                  <div className='group relative flex items-center'>
                    <Mail className='absolute left-3.5 size-5 text-stone-400 transition-colors group-focus-within:text-amber-500' />
                    <input
                      id='email-address'
                      name='email'
                      type='email'
                      autoComplete='email'
                      required
                      className='block w-full rounded-xl border border-stone-200/80 bg-surface/50 py-3.5 pr-4 pl-11 text-stone-900 placeholder-stone-400 transition-all duration-200 outline-none focus:border-amber-400 focus:bg-surface focus:ring-amber-400'
                      placeholder='name@example.com'
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>

                <div className='relative'>
                  <label
                    htmlFor='password'
                    className='mb-1.5 ml-1 block text-sm font-medium text-stone-600'>
                    {t('password')}
                  </label>
                  <div className='group relative flex items-center'>
                    <KeyRound className='absolute left-3.5 size-5 text-stone-400 transition-colors group-focus-within:text-amber-500' />
                    <input
                      id='password'
                      name='password'
                      type='password'
                      autoComplete={
                        isLogin ? 'current-password' : 'new-password'
                      }
                      required
                      className='block w-full rounded-xl border border-stone-200/80 bg-surface/50 py-3.5 pr-4 pl-11 text-stone-900 placeholder-stone-400 transition-all duration-200 outline-none focus:border-amber-400 focus:bg-surface focus:ring-amber-400'
                      placeholder={t('passwordPlaceholder')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </div>

                <AnimatePresence>
                  {!isLogin && (
                    <motion.div
                      initial={{ opacity: 0, height: 0, marginTop: 0 }}
                      animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
                      exit={{ opacity: 0, height: 0, marginTop: 0 }}
                      transition={{ duration: 0.3 }}
                      className='relative overflow-hidden'>
                      <label
                        htmlFor='confirmPassword'
                        className='mb-1.5 ml-1 block text-sm font-medium text-stone-600'>
                        {t('confirmPassword')}
                      </label>
                      <div className='group relative flex items-center'>
                        <KeyRound className='absolute left-3.5 size-5 text-stone-400 transition-colors group-focus-within:text-amber-500' />
                        <input
                          id='confirmPassword'
                          name='confirmPassword'
                          type='password'
                          autoComplete='new-password'
                          required={!isLogin}
                          className='block w-full rounded-xl border border-stone-200/80 bg-surface/50 py-3.5 pr-4 pl-11 text-stone-900 placeholder-stone-400 transition-all duration-200 outline-none focus:border-amber-400 focus:bg-surface focus:ring-amber-400'
                          placeholder={t('confirmPasswordPlaceholder')}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, y: -10, height: 0 }}
                    className='rounded-xl border border-red-100/50 bg-red-50 p-3 text-center text-sm font-medium text-red-700'>
                    {error}
                  </motion.div>
                )}

                {successMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -10, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, y: -10, height: 0 }}
                    className='rounded-xl border border-teal-100/50 bg-teal-50 p-3 text-center text-sm font-medium text-teal-700'>
                    {successMessage}
                  </motion.div>
                )}
              </AnimatePresence>

              {(ssoDisabled || ssoError) && (
                <motion.div
                  initial={{ opacity: 0, y: -10, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  className='rounded-xl border border-amber-200/70 bg-amber-50 p-3 text-center text-sm font-medium text-amber-800'>
                  <p>{ssoError ? t('ssoError') : t('ssoDisabled')}</p>
                  <a
                    href={ssoGuideUrl}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='mt-2 inline-block font-medium text-amber-900 underline decoration-amber-400 underline-offset-2 hover:text-amber-700'>
                    {t('ssoGuide')}
                  </a>
                </motion.div>
              )}

              <div className='flex flex-col gap-4 pt-4'>
                <button
                  type='submit'
                  disabled={loading}
                  className='group relative flex w-full items-center justify-center gap-2 rounded-xl border border-stone-800 bg-stone-900 px-4 py-4 text-sm font-medium text-surface transition-all duration-300 hover:-translate-y-0.5 hover:bg-stone-800 focus:ring-2 focus:ring-stone-900 focus:ring-offset-2 focus:outline-none disabled:cursor-wait disabled:opacity-70'>
                  {loading ? (
                    <span className='flex items-center gap-2.5'>
                      <svg
                        className='-ml-1 h-4 w-4 animate-spin text-current'
                        fill='none'
                        viewBox='0 0 24 24'>
                        <circle
                          className='opacity-25'
                          cx='12'
                          cy='12'
                          r='10'
                          stroke='currentColor'
                          strokeWidth='4'></circle>
                        <path
                          className='opacity-75'
                          fill='currentColor'
                          d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'></path>
                      </svg>
                      {t('loading')}
                    </span>
                  ) : (
                    <>
                      {isLogin ? t('login') : t('createAccount')}
                      {!isLogin && <UserPlus className='ml-1 size-4' />}
                    </>
                  )}
                </button>

                {!ssoDisabled && (
                  <>
                    <div className='relative flex items-center py-2 opacity-60'>
                      <div className='grow border-t border-stone-200'></div>
                      <span className='mx-4 shrink-0 text-sm font-medium text-stone-400'>
                        {t('or')}
                      </span>
                      <div className='grow border-t border-stone-200'></div>
                    </div>

                    <div className='grid grid-cols-1 gap-3'>
                      <button
                        type='button'
                        disabled={loading}
                        onClick={() => handleOAuthLogin('google')}
                        className='flex w-full items-center justify-center gap-2.5 rounded-xl border border-stone-200/80 bg-surface py-3.5 text-sm font-medium text-stone-700 transition-all duration-200 hover:bg-stone-50 hover:text-stone-900 focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:outline-none disabled:cursor-wait disabled:opacity-60'>
                        <svg
                          aria-hidden='true'
                          className='size-4'
                          viewBox='0 0 24 24'>
                          <path
                            fill='#4285F4'
                            d='M21.35 12.27c0-.79-.07-1.55-.23-2.27H12v4.3h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.7 2.91-4.2 2.91-7.42Z'
                          />
                          <path
                            fill='#34A853'
                            d='M12 21.5c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.7-1.72-5.47-4.03H3.28v2.53A9.74 9.74 0 0 0 12 21.5Z'
                          />
                          <path
                            fill='#FBBC05'
                            d='M6.53 13.58A5.86 5.86 0 0 1 6.22 12c0-.55.1-1.08.31-1.58V7.89H3.28A9.5 9.5 0 0 0 2.25 12c0 1.48.36 2.88 1.03 4.11l3.25-2.53Z'
                          />
                          <path
                            fill='#EA4335'
                            d='M12 6.39c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.84 3.48 14.63 2.5 12 2.5a9.74 9.74 0 0 0-8.72 5.39l3.25 2.53C7.3 8.11 9.46 6.39 12 6.39Z'
                          />
                        </svg>
                        Google
                      </button>
                    </div>
                  </>
                )}

                <button
                  type='button'
                  onClick={() => {
                    setIsLogin(!isLogin)
                    setError(null)
                    setSuccessMessage(null)
                    setSsoError(false)
                  }}
                  className='w-full rounded-xl border border-stone-200/80 bg-surface py-3.5 text-sm font-medium text-stone-600 transition-all duration-200 hover:bg-stone-50 hover:text-stone-900 focus:outline-none'>
                  {isLogin ? t('noAccount') : t('hasAccount')}
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </div>

      <Footer className='relative z-10 mt-auto border-none bg-transparent' />
    </div>
  )
}
