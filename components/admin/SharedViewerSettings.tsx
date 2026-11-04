'use client'

import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'

import { saveSharedViewer } from '@/app/actions/shared-viewer'
import { basicInputClass } from '@/components/MemorialFields'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { sharedViewerMessages } from '@/lib/i18n/shared-viewer'

export default function SharedViewerSettings({
  account,
  available
}: {
  account?: { is_active: boolean }
  available: boolean
}) {
  const { locale } = useI18n()
  const text = sharedViewerMessages[locale]
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [enabled, setEnabled] = useState(account?.is_active ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const formData = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const result = await saveSharedViewer(formData)
      router.refresh()
      if (result.error) setError(text[result.error])
      else {
        setPin('')
        setSaved(true)
      }
    } catch {
      setError(text.unavailable)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className='mb-6 space-y-4 rounded-3xl border border-border bg-surface p-4 text-sm sm:p-6'>
      <h2 className='text-lg font-semibold'>{text.title}</h2>
      <p className='text-secondary'>{text.settingsHint}</p>
      <p className='font-medium'>
        {account
          ? account.is_active
            ? text.active
            : text.locked
          : text.notCreated}
      </p>
      {!available && (
        <p role='alert' className='text-error'>
          {text.migration}
        </p>
      )}
      <form onSubmit={submit} className='space-y-4'>
        <label className='block max-w-sm space-y-2 text-secondary'>
          <span>{text.newPin}</span>
          <input
            name='pin'
            type='password'
            inputMode='numeric'
            pattern='[0-9]{8}'
            minLength={8}
            maxLength={8}
            autoComplete='new-password'
            required={!account}
            disabled={busy || !available}
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            className={basicInputClass}
          />
          <span className='block'>{text.pinHint}</span>
        </label>
        <label className='flex items-center gap-2 text-secondary'>
          <input
            name='enabled'
            type='checkbox'
            checked={enabled}
            disabled={busy || !available}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          {text.enabled}
        </label>
        {error && (
          <p role='alert' className='text-error'>
            {error}
          </p>
        )}
        {saved && (
          <p role='status' className='text-secondary'>
            {text.saved}
          </p>
        )}
        <button
          disabled={busy || !available}
          className='rounded-xl bg-primary px-4 py-3 text-surface disabled:opacity-50'>
          {busy ? text.working : text.save}
        </button>
      </form>
    </section>
  )
}
