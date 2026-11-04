'use client'

import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'

import { signInSharedViewer } from '@/app/actions/shared-viewer'
import { basicInputClass } from '@/components/MemorialFields'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { sharedViewerMessages } from '@/lib/i18n/shared-viewer'

export default function SharedViewerLogin() {
  const { locale } = useI18n()
  const text = sharedViewerMessages[locale]
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await signInSharedViewer(pin)
      if (result.error) setError(text[result.error])
      else {
        router.push('/dashboard')
        router.refresh()
      }
    } catch {
      setError(text.unavailable)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className='relative z-10 space-y-4 text-sm'>
      <p className='text-secondary'>{text.description}</p>
      <label className='block space-y-2 text-secondary'>
        <span>{text.pin}</span>
        <input
          name='shared-pin'
          type='password'
          inputMode='numeric'
          pattern='[0-9]{8}'
          autoComplete='current-password'
          minLength={8}
          maxLength={8}
          required
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          className={basicInputClass}
        />
      </label>
      {error && (
        <p role='alert' className='text-error'>
          {error}
        </p>
      )}
      <button
        disabled={busy}
        className='w-full rounded-xl bg-primary px-4 py-3 text-surface disabled:opacity-50'>
        {busy ? text.working : text.enter}
      </button>
    </form>
  )
}
