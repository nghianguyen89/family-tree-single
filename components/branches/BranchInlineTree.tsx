'use client'

import Image from 'next/image'

import DefaultAvatar from '@/components/DefaultAvatar'
import { branchesMessages } from '@/lib/i18n/branches'
import { useI18n } from '@/lib/i18n/I18nProvider'
import type { BranchTreePreview } from '@/types/branches'
import { getAvatarUrl } from '@/utils/avatar'
import { branchFirstGeneration } from '@/utils/familyBranches'

export default function BranchInlineTree({
  preview
}: {
  preview: BranchTreePreview
}) {
  const { locale } = useI18n()
  const persons = branchFirstGeneration(preview)
  return (
    <div className='flex gap-4 overflow-x-auto' data-auxiliary-tree='true'>
      {persons.map((person) => (
        <figure
          key={person.id}
          className='flex w-28 shrink-0 flex-col items-center gap-2'>
          <div className='size-12 overflow-hidden rounded-full'>
            {getAvatarUrl(person.avatar_url) ? (
              <Image
                unoptimized
                src={getAvatarUrl(person.avatar_url)!}
                alt={person.full_name}
                width={48}
                height={48}
                className='size-full object-cover'
              />
            ) : (
              <DefaultAvatar gender={person.gender} size={48} />
            )}
          </div>
          <figcaption className='w-full text-center text-sm font-medium text-primary'>
            {person.full_name}
          </figcaption>
        </figure>
      ))}
      {!persons.length && (
        <p className='text-sm text-secondary'>
          {branchesMessages[locale].emptyFirstGeneration}
        </p>
      )}
    </div>
  )
}
