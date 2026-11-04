'use client'

import { useMemberListView } from '@/context/MemberListContext'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { Person } from '@/types'

import PersonSelector from './PersonSelector'

export default function RootSelector({
  persons,
  currentRootId
}: {
  persons: Person[]
  currentRootId: string
}) {
  const { t } = useI18n()
  const { setRootId } = useMemberListView()

  return (
    <PersonSelector
      persons={persons}
      selectedId={currentRootId}
      onSelect={(id) => {
        if (id) setRootId(id)
      }}
      placeholder={t('choosePerson')}
      label={t('displayRoot')}
      className='w-full sm:w-72'
    />
  )
}
