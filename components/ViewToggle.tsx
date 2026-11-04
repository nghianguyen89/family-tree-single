'use client'

import { Circle, List, ListTree, Network } from 'lucide-react'

import { useMemberListView } from '@/context/MemberListContext'
import { useI18n } from '@/lib/i18n/I18nProvider'

export type ViewMode = 'list' | 'tree' | 'mindmap' | 'bubble'

export default function ViewToggle() {
  const { t } = useI18n()
  const { view: currentView, setView } = useMemberListView()

  const tabs = [
    {
      id: 'list',
      label: t('viewList'),
      icon: <List className='size-6 sm:size-4' />
    },
    {
      id: 'tree',
      label: t('viewTree'),
      icon: <Network className='size-6 sm:size-4' />
    },
    {
      id: 'mindmap',
      label: t('viewMindmap'),
      icon: <ListTree className='size-6 sm:size-4' />
    },
    {
      id: 'bubble',
      label: t('viewBubble'),
      icon: <Circle className='size-6 sm:size-4' />
    }
  ] as const

  return (
    <div className='relative z-10 mx-auto mt-4 mb-2 flex w-fit rounded-full border border-stone-200/60 bg-stone-100 p-1.5'>
      {tabs.map((tab) => {
        const isActive = currentView === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => setView(tab.id as ViewMode)}
            className={`relative z-10 flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-300 ease-in-out sm:px-6 sm:py-2.5 ${
              isActive
                ? 'bg-surface text-stone-900'
                : 'text-stone-500 hover:text-stone-800'
            }`}>
            <span
              className={`transition-colors duration-300 ${isActive ? 'text-amber-700' : 'text-stone-400'}`}>
              {tab.icon}
            </span>
            <span className='hidden sm:block'>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
