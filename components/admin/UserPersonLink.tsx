'use client'

import { useState } from 'react'

import { linkUserPerson } from '@/app/actions/user'
import { useI18n } from '@/lib/i18n/I18nProvider'
import type { AdminUserData } from '@/types'

export interface UserPersonOption {
  id: string
  full_name: string
  birth_year: number | null
}

const messages = {
  vi: {
    search: 'Tìm người theo tên',
    person: 'Người đại diện cho tài khoản',
    none: 'Chưa liên kết',
    unknown: 'Chưa tải được liên kết',
    unavailable: 'Người đã liên kết không có trong danh sách',
    save: 'Lưu liên kết',
    remove: 'Gỡ liên kết',
    saving: 'Đang lưu…',
    confirm: 'Xác nhận tài khoản này đại diện cho người đã chọn?',
    confirmRemove: 'Gỡ liên kết người đại diện của tài khoản này?',
    saved: 'Đã lưu liên kết.',
    removed: 'Đã gỡ liên kết.',
    unknownYear: 'Chưa rõ năm sinh',
    permission: 'Chỉ admin đang hoạt động được liên kết tài khoản.',
    invalid: 'Tài khoản hoặc người được chọn không hợp lệ.',
    migration: 'Cần áp dụng migration liên kết tài khoản trước khi lưu.',
    alreadyLinked: 'Người này đã liên kết với tài khoản khác.',
    saveFailed: 'Không lưu được liên kết. Vui lòng tải lại và thử lại.'
  },
  en: {
    search: 'Search people by name',
    person: 'Person represented by this account',
    none: 'Not linked',
    unknown: 'Account link could not be loaded',
    unavailable: 'Linked person is unavailable in this list',
    save: 'Save link',
    remove: 'Remove link',
    saving: 'Saving…',
    confirm: 'Confirm that this account represents the selected person?',
    confirmRemove: 'Remove the person linked to this account?',
    saved: 'Account link saved.',
    removed: 'Account link removed.',
    unknownYear: 'Birth year unknown',
    permission: 'Only active admins can link accounts.',
    invalid: 'The account or selected person is invalid.',
    migration: 'Apply the account-link migration before saving.',
    alreadyLinked: 'This person is already linked to another account.',
    saveFailed: 'The account link could not be saved. Reload and try again.'
  }
}

export default function UserPersonLink({
  user,
  persons,
  disabled,
  onSaved
}: {
  user: AdminUserData
  persons: UserPersonOption[]
  disabled: boolean
  onSaved: (personId: string | null) => void
}) {
  const { locale } = useI18n()
  const copy = messages[locale]
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState(user.person_id || '')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null
  )
  const savedId = user.person_id || ''
  const missingSelection =
    selection && !persons.some((person) => person.id === selection)
  const filtered = persons.filter(
    (person) =>
      person.id === selection ||
      person.full_name
        .toLocaleLowerCase(locale)
        .includes(query.trim().toLocaleLowerCase(locale))
  )

  async function save(personId: string | null) {
    if (disabled || saving) return
    if (!window.confirm(personId ? copy.confirm : copy.confirmRemove)) return
    setSaving(true)
    setNotice(null)
    try {
      const result = await linkUserPerson(user.id, personId)
      if (result.error) {
        const key = result.error as keyof typeof copy
        setNotice({ text: copy[key] || copy.saveFailed, error: true })
        return
      }
      if (!result.success) {
        setNotice({ text: copy.saveFailed, error: true })
        return
      }
      setSelection(personId || '')
      setNotice({ text: personId ? copy.saved : copy.removed, error: false })
      onSaved(personId)
    } catch {
      setNotice({ text: copy.saveFailed, error: true })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='w-64 space-y-2 text-sm whitespace-normal'>
      <label htmlFor={`person-search-${user.id}`} className='sr-only'>
        {copy.search} — {user.email}
      </label>
      <input
        id={`person-search-${user.id}`}
        type='search'
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={copy.search}
        disabled={disabled || saving}
        className='w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-tertiary disabled:opacity-50'
      />
      <label htmlFor={`person-link-${user.id}`} className='sr-only'>
        {copy.person} — {user.email}
      </label>
      <select
        id={`person-link-${user.id}`}
        value={selection}
        onChange={(event) => setSelection(event.target.value)}
        disabled={disabled || saving}
        className='w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-tertiary disabled:opacity-50'>
        <option value=''>
          {user.person_id === undefined ? copy.unknown : copy.none}
        </option>
        {missingSelection && (
          <option value={selection}>{copy.unavailable}</option>
        )}
        {filtered.map((person) => (
          <option key={person.id} value={person.id}>
            {person.full_name} · {person.birth_year ?? copy.unknownYear} ·{' '}
            {person.id.slice(0, 8)}
          </option>
        ))}
      </select>
      <div className='flex flex-wrap gap-2'>
        <button
          type='button'
          disabled={
            disabled ||
            saving ||
            !selection ||
            !!missingSelection ||
            selection === savedId
          }
          onClick={() => save(selection)}
          className='rounded-lg bg-primary px-3 py-2 text-sm text-surface disabled:opacity-50'>
          {saving ? copy.saving : copy.save}
        </button>
        {savedId && (
          <button
            type='button'
            disabled={disabled || saving}
            onClick={() => save(null)}
            className='rounded-lg border border-border px-3 py-2 text-sm text-secondary disabled:opacity-50'>
            {copy.remove}
          </button>
        )}
      </div>
      {notice && (
        <p
          role={notice.error ? 'alert' : 'status'}
          className={notice.error ? 'text-error' : 'text-secondary'}>
          {notice.text}
        </p>
      )}
    </div>
  )
}
