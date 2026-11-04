'use client'

import { Share2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { useMemberListView } from '@/context/MemberListContext'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { Person, Relationship } from '@/types'
import { buildAdjacencyLists } from '@/utils/treeHelpers'

import { MindmapContextData, MindmapNode } from './MindmapNode'
import MindmapToolbar from './MindmapToolbar'

const DEFAULT_AUTO_COLLAPSE_LEVEL = 2

interface MindmapTreeProps {
  personsMap: Map<string, Person>
  relationships: Relationship[]
  roots: Person[]
  canEdit?: boolean
}

export default function MindmapTree({
  personsMap,
  relationships,
  roots,
  canEdit
}: MindmapTreeProps) {
  const { showAvatar, setMemberModalId } = useMemberListView()
  const { t } = useI18n()
  const [hideDaughtersInLaw, setHideDaughtersInLaw] = useState(false)
  const [hideSonsInLaw, setHideSonsInLaw] = useState(false)
  const [hideDaughters, setHideDaughters] = useState(false)
  const [hideSons, setHideSons] = useState(false)
  const [hideMales, setHideMales] = useState(false)
  const [hideFemales, setHideFemales] = useState(false)
  const [hideExpandButtons, setHideExpandButtons] = useState(false)
  const [autoCollapseLevel, setAutoCollapseLevel] = useState(
    DEFAULT_AUTO_COLLAPSE_LEVEL
  )
  const [expandSignal, setExpandSignal] = useState<{
    type: 'expand' | 'collapse'
    ts: number
  } | null>(null)

  // Adjacency lists only depend on the data, not on the view filters
  const adj = useMemo(
    () => buildAdjacencyLists(relationships, personsMap),
    [relationships, personsMap]
  )

  const ctx: MindmapContextData = useMemo(() => {
    return {
      personsMap,
      relationships,
      adj,
      hideDaughtersInLaw,
      hideSonsInLaw,
      hideDaughters,
      hideSons,
      hideMales,
      hideFemales,
      showAvatar,
      hideExpandButtons,
      autoCollapseLevel,
      expandSignal,
      setMemberModalId
    }
  }, [
    personsMap,
    relationships,
    adj,
    hideDaughtersInLaw,
    hideSonsInLaw,
    hideDaughters,
    hideSons,
    hideMales,
    hideFemales,
    showAvatar,
    hideExpandButtons,
    autoCollapseLevel,
    expandSignal,
    setMemberModalId
  ])

  if (roots.length === 0) {
    return (
      <div className='p-12 text-center'>
        <div className='mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-stone-100'>
          <Share2 className='size-8 text-stone-300' />
        </div>
        <p className='font-medium text-stone-500'>{t('emptyFamilyTree')}</p>
      </div>
    )
  }

  return (
    <div className='relative flex h-full min-h-[calc(100vh-140px)] w-full justify-start overflow-x-auto p-4 sm:p-6 lg:justify-center lg:p-8'>
      <MindmapToolbar
        hideDaughtersInLaw={hideDaughtersInLaw}
        setHideDaughtersInLaw={setHideDaughtersInLaw}
        hideSonsInLaw={hideSonsInLaw}
        setHideSonsInLaw={setHideSonsInLaw}
        hideDaughters={hideDaughters}
        setHideDaughters={setHideDaughters}
        hideSons={hideSons}
        setHideSons={setHideSons}
        hideMales={hideMales}
        setHideMales={setHideMales}
        hideFemales={hideFemales}
        setHideFemales={setHideFemales}
        hideExpandButtons={hideExpandButtons}
        setHideExpandButtons={setHideExpandButtons}
        autoCollapseLevel={autoCollapseLevel}
        setAutoCollapseLevel={setAutoCollapseLevel}
        setExpandSignal={setExpandSignal}
        canEdit={canEdit}
      />

      {/* Root Container */}
      <div
        id='export-container'
        className='min-w-max p-10 px-0 pb-20 font-sans sm:px-8'>
        {roots.map((root, index) => (
          <MindmapNode
            key={root.id}
            personId={root.id}
            level={0}
            isLast={index === roots.length - 1}
            ctx={ctx}
          />
        ))}
      </div>
    </div>
  )
}
