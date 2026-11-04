'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { trashContent } from '@/app/actions/content'
import { contentText } from '@/lib/i18n/content'
import type { ContentEntry } from '@/types/content'

export default function ContentListActions({
  entry,
  locale
}: {
  entry: ContentEntry
  locale: string
}) {
  const t = contentText(locale),
    router = useRouter()
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  async function apply() {
    setBusy(true)
    setMessage('')
    try {
      const result = await trashContent(
        entry.id,
        entry.revision,
        !!entry.deleted_at
      )
      if (result.error)
        setMessage(result.error === 'conflict' ? t.conflict : t.error)
      else router.refresh()
    } catch {
      setMessage(t.error)
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }
  return (
    <div className='space-y-2'>
      <div className='flex flex-wrap gap-2'>
        <button
          className='btn-outline'
          type='button'
          disabled={busy}
          onClick={() =>
            entry.deleted_at || confirm ? void apply() : setConfirm(true)
          }>
          {busy
            ? t.saving
            : entry.deleted_at
              ? t.restore
              : confirm
                ? t.confirmTrash
                : t.moveTrash}
        </button>
        {confirm && (
          <button
            type='button'
            className='btn-outline'
            onClick={() => setConfirm(false)}>
            {t.cancel}
          </button>
        )}
      </div>
      <p role='status' className='max-w-md text-sm text-secondary'>
        {message}
      </p>
    </div>
  )
}
