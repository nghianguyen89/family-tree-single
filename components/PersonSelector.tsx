'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Database, Search } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'

import { useI18n } from '@/lib/i18n/I18nProvider'
import { Person } from '@/types'
import { getAvatarUrl } from '@/utils/avatar'

import DefaultAvatar from './DefaultAvatar'
import { FemaleIcon, MaleIcon } from './GenderIcons'

// ── Helpers ──────────────────────────────────────────────────────────────────
const getGenderStyle = (gender: string) => {
  if (gender === 'male') return 'bg-sky-100 text-sky-600'
  if (gender === 'female') return 'bg-rose-100 text-rose-600'
  return 'bg-stone-100 text-stone-600'
}

const getAvatarBg = (gender: string) => {
  if (gender === 'male') return 'bg-linear-to-br from-sky-400 to-sky-700'
  if (gender === 'female') return 'bg-linear-to-br from-rose-400 to-rose-700'
  return 'bg-linear-to-br from-stone-400 to-stone-600'
}

export default function PersonSelector({
  persons,
  selectedId,
  onSelect,
  placeholder,
  label,
  className = 'w-full sm:w-72',
  showAllOption = false,
  allOptionLabel
}: {
  persons: Person[]
  selectedId?: string | null
  onSelect: (id: string | null) => void
  placeholder?: string
  label?: string
  className?: string
  showAllOption?: boolean
  allOptionLabel?: string
}) {
  const { t } = useI18n()
  const resolvedPlaceholder = placeholder ?? t('choosePerson')
  const resolvedLabel = label ?? t('displayRoot')
  const resolvedAllOptionLabel = allOptionLabel ?? t('allData')
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  const currentPerson = persons.find((p) => p.id === selectedId)

  const filteredPersons = persons
    .filter((p) => {
      const searchStr = `${p.full_name} ${p.birth_year || ''}`.toLowerCase()
      return searchStr.includes(searchTerm.toLowerCase())
    })
    .slice(0, 20)

  const handleSelect = (personId: string | null) => {
    onSelect(personId)
    setIsOpen(false)
    setSearchTerm('')
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`group flex w-full items-center gap-3 rounded-xl border bg-surface/60 px-3 py-2 text-sm transition-all duration-300 focus:ring-2 focus:ring-amber-500/20 focus:outline-none ${isOpen ? 'border-amber-300 bg-surface ring-2 ring-amber-500/10' : 'border-stone-200/60 hover:border-amber-300 hover:bg-surface/90'}`}>
        <div className='relative shrink-0'>
          <div
            className={`flex size-8 items-center justify-center overflow-hidden rounded-full text-sm font-medium shadow-xs ring-2 ring-surface ${
              currentPerson
                ? `${getAvatarBg(currentPerson.gender)} text-white`
                : showAllOption && selectedId === null
                  ? 'bg-stone-500 text-white'
                  : 'bg-stone-100 text-stone-400'
            }`}>
            {currentPerson ? (
              getAvatarUrl(currentPerson.avatar_url) ? (
                <Image
                  unoptimized
                  src={getAvatarUrl(currentPerson.avatar_url)!}
                  alt={currentPerson.full_name}
                  width={32}
                  height={32}
                  className='h-full w-full object-cover'
                />
              ) : (
                <DefaultAvatar gender={currentPerson.gender} size={32} />
              )
            ) : showAllOption && selectedId === null ? (
              <Database className='size-4' />
            ) : (
              '?'
            )}
          </div>
          {currentPerson && (
            <div
              className={`absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full shadow-xs ring-2 ring-surface ${getGenderStyle(currentPerson.gender)}`}>
              {currentPerson.gender === 'male' ? (
                <MaleIcon className='size-2.5' />
              ) : currentPerson.gender === 'female' ? (
                <FemaleIcon className='size-2.5' />
              ) : null}
            </div>
          )}
        </div>

        <div className='min-w-0 flex-1 text-left'>
          {label && (
            <p className='mb-0.5 text-sm leading-none font-medium text-stone-400'>
              {resolvedLabel}
            </p>
          )}
          <p className='truncate leading-tight font-medium text-stone-800 select-none'>
            {currentPerson
              ? `${currentPerson.full_name} ${currentPerson.birth_year ? `(${currentPerson.birth_year})` : ''}`
              : showAllOption && !selectedId
                ? resolvedAllOptionLabel
                : resolvedPlaceholder}
          </p>
        </div>

        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}>
          <ChevronDown
            className={`size-4 shrink-0 transition-colors ${isOpen ? 'text-amber-600' : 'text-stone-400 group-hover:text-stone-600'}`}
          />
        </motion.div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className='absolute z-50 mt-2 flex max-h-80 w-full flex-col overflow-hidden rounded-xl border border-stone-200/80 bg-surface ring-1 ring-black/5'>
            <div className='sticky top-0 z-10 border-b border-stone-100/80 bg-stone-50/50 p-2'>
              <div className='relative'>
                <Search className='absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400' />
                <input
                  type='text'
                  className='w-full rounded-lg border border-stone-200/80 bg-surface py-2 pr-3 pl-9 text-sm text-stone-900 placeholder-stone-400 transition-all outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20'
                  placeholder={t('searchMembers')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className='custom-scrollbar flex-1 overflow-y-auto p-1.5'>
              {showAllOption && searchTerm.toLowerCase() === '' && (
                <button
                  onClick={() => handleSelect(null)}
                  className={`group/item mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200 ${
                    selectedId === null
                      ? 'border border-amber-200/50 bg-amber-50 text-amber-900'
                      : 'border border-transparent text-stone-700 hover:bg-stone-100/80'
                  }`}>
                  <div className='relative shrink-0'>
                    <div className='flex size-8 items-center justify-center rounded-full bg-stone-500 text-white shadow-xs ring-1 ring-surface'>
                      <Database className='size-4' />
                    </div>
                  </div>
                  <div className='min-w-0 flex-1 text-left'>
                    <p
                      className={`truncate ${selectedId === null ? 'font-medium' : 'font-medium group-hover/item:text-stone-900'}`}>
                      {resolvedAllOptionLabel}
                    </p>
                  </div>
                  {selectedId === null && (
                    <Check className='size-4 shrink-0 text-amber-600' />
                  )}
                </button>
              )}

              {filteredPersons.length > 0 ? (
                <div className='space-y-0.5'>
                  {filteredPersons.map((person) => {
                    const isSelected = person.id === selectedId
                    return (
                      <button
                        key={person.id}
                        onClick={() => handleSelect(person.id)}
                        className={`group/item flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200 ${
                          isSelected
                            ? 'border border-amber-200/50 bg-amber-50 text-amber-900'
                            : 'border border-transparent text-stone-700 hover:bg-stone-100/80'
                        }`}>
                        <div className='relative shrink-0'>
                          <div
                            className={`flex size-8 items-center justify-center overflow-hidden rounded-full text-sm font-medium text-white shadow-xs ring-1 ring-surface ${getAvatarBg(person.gender)}`}>
                            {getAvatarUrl(person.avatar_url) ? (
                              <Image
                                unoptimized
                                src={getAvatarUrl(person.avatar_url)!}
                                alt={person.full_name}
                                width={32}
                                height={32}
                                className='h-full w-full object-cover'
                              />
                            ) : (
                              <DefaultAvatar gender={person.gender} size={32} />
                            )}
                          </div>
                          <div
                            className={`absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full shadow-xs ring-1 ring-surface ${getGenderStyle(person.gender)}`}>
                            {person.gender === 'male' ? (
                              <MaleIcon className='size-2.5' />
                            ) : person.gender === 'female' ? (
                              <FemaleIcon className='size-2.5' />
                            ) : null}
                          </div>
                        </div>

                        <div className='min-w-0 flex-1 text-left'>
                          <p
                            className={`truncate ${isSelected ? 'font-medium' : 'font-medium group-hover/item:text-stone-900'}`}>
                            {person.full_name}{' '}
                            {person.birth_year ? (
                              <span className='font-normal text-stone-400'>
                                ({person.birth_year})
                              </span>
                            ) : null}
                          </p>
                          {person.generation != null && (
                            <p className='text-sm font-medium text-stone-400'>
                              {t('generationLabel', {
                                generation: person.generation
                              })}
                            </p>
                          )}
                        </div>

                        {isSelected && (
                          <Check className='size-4 shrink-0 text-amber-600' />
                        )}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className='flex flex-col items-center justify-center gap-2 px-4 py-8 text-center'>
                  <div className='mb-1 flex size-10 items-center justify-center rounded-full bg-stone-100'>
                    <Search className='size-5 text-stone-300' />
                  </div>
                  <div className='text-sm font-medium text-stone-600'>
                    {t('noSearchResults')}
                  </div>
                  <div className='text-sm text-stone-400'>
                    {t('tryOtherName')}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
