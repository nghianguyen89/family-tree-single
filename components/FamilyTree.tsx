'use client'

import { Minus, Plus } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useMemberListView } from '@/context/MemberListContext'
import { usePanZoom } from '@/hooks/usePanZoom'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { Person, Relationship } from '@/types'
import { buildAdjacencyLists, getFilteredTreeData } from '@/utils/treeHelpers'

import BranchNodeLinks from './branches/BranchNodeLinks'
import FamilyNodeCard from './FamilyNodeCard'
import TreeToolbar from './TreeToolbar'

const DEFAULT_AUTO_COLLAPSE_LEVEL = 4

export default function FamilyTree({
  personsMap,
  relationships,
  roots,
  canEdit
}: {
  personsMap: Map<string, Person>
  relationships: Relationship[]
  roots: Person[]
  canEdit?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
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

  const { showAvatar } = useMemberListView()
  const { t } = useI18n()

  const {
    scale,
    isPressed,
    isDragging,
    handlers: {
      handleMouseDown,
      handleMouseMove,
      handleMouseUpOrLeave,
      handleClickCapture,
      handleZoomIn,
      handleZoomOut,
      handleResetZoom
    }
  } = usePanZoom(containerRef)

  // Center the scroll area horizontally
  const centerTree = useCallback(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const inner = el.querySelector('#export-container')
    if (inner) {
      const innerRect = inner.getBoundingClientRect()
      const containerRect = el.getBoundingClientRect()
      el.scrollLeft +=
        innerRect.left +
        innerRect.width / 2 -
        (containerRect.left + containerRect.width / 2)
    } else {
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
    }
  }, [])

  const adj = useMemo(
    () => buildAdjacencyLists(relationships, personsMap),
    [relationships, personsMap]
  )

  const filters = useMemo(
    () => ({
      hideDaughtersInLaw,
      hideSonsInLaw,
      hideDaughters,
      hideSons,
      hideMales,
      hideFemales
    }),
    [
      hideDaughtersInLaw,
      hideSonsInLaw,
      hideDaughters,
      hideSons,
      hideMales,
      hideFemales
    ]
  )

  const getTreeData = useCallback(
    (personId: string) =>
      getFilteredTreeData(personId, personsMap, adj, filters),
    [personsMap, adj, filters]
  )

  // Branches from `autoCollapseLevel` down start collapsed. This is computed
  // synchronously so the first paint never renders the whole (possibly huge)
  // tree before collapsing it.
  const autoCollapsed = useMemo(() => {
    const collapsed = new Set<string>()
    if (autoCollapseLevel <= 0) return collapsed

    const visited = new Set<string>()
    const walk = (personId: string, level: number) => {
      if (visited.has(personId)) return
      visited.add(personId)

      const children = adj.childrenByPersonId.get(personId) ?? []
      if (level >= autoCollapseLevel && children.length > 0) {
        collapsed.add(personId)
      }
      children.forEach((child) => walk(child.id, level + 1))
    }

    roots.forEach((root) => walk(root.id, 0))
    return collapsed
  }, [roots, adj, autoCollapseLevel])

  // Manual expand/collapse toggles, reset whenever the automatic baseline changes
  const [collapseState, setCollapseState] = useState({
    base: autoCollapsed,
    nodes: autoCollapsed
  })
  const collapsedNodes =
    collapseState.base === autoCollapsed ? collapseState.nodes : autoCollapsed

  const toggleCollapse = useCallback(
    (personId: string) => {
      setCollapseState((prev) => {
        const current = prev.base === autoCollapsed ? prev.nodes : autoCollapsed
        const next = new Set(current)
        if (next.has(personId)) {
          next.delete(personId)
        } else {
          next.add(personId)
        }
        return { base: autoCollapsed, nodes: next }
      })
    },
    [autoCollapsed]
  )

  // Center once the new layout has been committed
  useEffect(() => {
    const raf = requestAnimationFrame(centerTree)
    return () => cancelAnimationFrame(raf)
  }, [autoCollapsed, centerTree])

  useEffect(() => {
    const equalizeHeights = () => {
      // Only equalize the people row. Auxiliary panels can grow independently.
      if (!containerRef.current) return
      const nodes = containerRef.current.querySelectorAll('.node-container')
      const levelMap: Record<string, HTMLElement[]> = {}

      nodes.forEach((node) => {
        const level = node.getAttribute('data-level')
        if (level != null) {
          if (!levelMap[level]) levelMap[level] = []
          levelMap[level].push(node as HTMLElement)
        }
      })

      Object.values(levelMap).forEach((levelNodes) => {
        // Reset min-height first to get natural height
        levelNodes.forEach((node) => {
          const innerFlex = node.querySelector<HTMLElement>(
            ':scope > [data-family-card]'
          )
          if (innerFlex) innerFlex.style.minHeight = '0px'
        })

        let maxHeight = 0
        // Find the maximum height in this level
        levelNodes.forEach((node) => {
          const innerFlex = node.querySelector<HTMLElement>(
            ':scope > [data-family-card]'
          )
          if (innerFlex) {
            maxHeight = Math.max(maxHeight, innerFlex.offsetHeight)
          }
        })

        // Apply max height to all nodes in this level
        levelNodes.forEach((node) => {
          const innerFlex = node.querySelector<HTMLElement>(
            ':scope > [data-family-card]'
          )
          if (innerFlex && maxHeight > 0) {
            innerFlex.style.minHeight = `${maxHeight}px`
          }
        })
      })
    }

    let frame = 0
    const scheduleEqualize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(equalizeHeights)
    }

    scheduleEqualize()
    window.addEventListener('resize', scheduleEqualize)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', scheduleEqualize)
    }
    // `scale` is intentionally not a dependency: CSS transforms don't change
    // layout heights, so zooming never needs a re-measure.
  }, [
    roots,
    personsMap,
    relationships,
    showAvatar,
    hideDaughtersInLaw,
    hideSonsInLaw,
    hideDaughters,
    hideSons,
    hideMales,
    hideFemales,
    collapsedNodes
  ])

  const handleCenter = centerTree

  // The node tree is memoized so zooming and panning (which only change
  // `scale` / drag state) never re-render thousands of nodes.
  const treeContent = useMemo(() => {
    // Tracks visited IDs to prevent infinite loops from circular relationships
    const renderTreeNode = (
      personId: string,
      visited: Set<string>,
      level: number
    ): React.ReactNode => {
      if (visited.has(personId)) return null // cycle guard
      visited.add(personId)

      const data = getTreeData(personId)
      if (!data.person) return null

      const hasChildren = data.children.length > 0
      const isCollapsed = collapsedNodes.has(personId)

      return (
        <li>
          <div
            className='node-container relative inline-flex flex-col items-center'
            data-level={level}
            data-person-id={personId}>
            {/* Main Person & Spouses Row */}
            <div
              data-family-card='true'
              className={`relative z-10 flex h-full items-stretch ${showAvatar ? 'rounded-2xl border border-stone-200/80 bg-surface' : ''}`}>
              <FamilyNodeCard person={data.person} level={level} />

              {data.spouses.map((spouseData, idx) => (
                <div key={spouseData.person.id} className='relative flex'>
                  <FamilyNodeCard
                    isRingVisible={idx === 0}
                    isPlusVisible={idx > 0}
                    person={spouseData.person}
                    level={level}
                  />
                </div>
              ))}
            </div>

            {/* Auxiliary panels must not be measured as part of family cards. */}
            <BranchNodeLinks personId={data.person.id} />
            {data.spouses.map((spouse) => (
              <BranchNodeLinks
                key={spouse.person.id}
                personId={spouse.person.id}
              />
            ))}

            {/* Main descendants toggle stays below any auxiliary panels. */}
            {!hideExpandButtons && hasChildren && (
              <button
                type='button'
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  toggleCollapse(personId)
                }}
                className='absolute -bottom-3 left-1/2 z-100 flex size-6 -translate-x-1/2 items-center justify-center rounded-full border border-stone-200/80 bg-surface text-stone-500 transition-colors hover:border-amber-300 hover:text-amber-600'
                title={isCollapsed ? t('expand') : t('collapse')}
                aria-label={isCollapsed ? t('expand') : t('collapse')}
                aria-expanded={!isCollapsed}>
                {isCollapsed ? (
                  <Plus className='h-3.5 w-3.5' />
                ) : (
                  <Minus className='h-3.5 w-3.5' />
                )}
              </button>
            )}
          </div>

          {/* Render Children (if any and not collapsed) */}
          {hasChildren && !isCollapsed && (
            <ul>
              {data.children.map((child) => (
                <React.Fragment key={child.id}>
                  {renderTreeNode(child.id, new Set(visited), level + 1)}
                </React.Fragment>
              ))}
            </ul>
          )}
        </li>
      )
    }

    return roots.map((root) => (
      <React.Fragment key={root.id}>
        {renderTreeNode(root.id, new Set(), 0)}
      </React.Fragment>
    ))
  }, [
    roots,
    getTreeData,
    collapsedNodes,
    showAvatar,
    hideExpandButtons,
    toggleCollapse,
    t
  ])

  if (roots.length === 0)
    return (
      <div className='p-10 text-center text-stone-500'>{t('noTreeData')}</div>
    )

  return (
    <div className='relative h-full w-full'>
      <TreeToolbar
        scale={scale}
        handleZoomIn={handleZoomIn}
        handleZoomOut={handleZoomOut}
        handleResetZoom={handleResetZoom}
        handleCenter={handleCenter}
        hideExpandButtons={hideExpandButtons}
        setHideExpandButtons={setHideExpandButtons}
        autoCollapseLevel={autoCollapseLevel}
        setAutoCollapseLevel={setAutoCollapseLevel}
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
        canEdit={canEdit}
      />

      <div
        ref={containerRef}
        className={`h-full w-full overflow-auto bg-stone-50 ${isPressed ? 'cursor-grabbing' : 'cursor-grab'}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        onClickCapture={handleClickCapture}
        onDragStart={(e) => e.preventDefault()} // Prevent browser default dragging of links/images
      >
        {/* We use a style block to inject the CSS logic for the family tree lines */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
        .css-tree ul {
          padding-top: 30px; 
          position: relative;
          display: flex;
          justify-content: center;
          padding-left: 0;
          user-select: none;
        }

        .css-tree li {
          float: left; text-align: center;
          list-style-type: none;
          position: relative;
          padding: 30px 5px 0 5px;
        }

        /* Connecting lines */
        .css-tree li::before, .css-tree li::after {
          content: '';
          position: absolute; top: 0; right: 50%;
          border-top: 2px solid var(--color-stone-300);
          width: 50%; height: 30px;
        }
        .css-tree li::after {
          right: auto; left: 50%;
          border-left: 2px solid var(--color-stone-300);
        }

        /* Remove left-right connectors from elements without siblings */
        .css-tree li:only-child::after {
          display: none;
        }
        .css-tree li:only-child::before {
          content: '';
          position: absolute;
          top: 0;
          left: 50%;
          border-left: 2px solid var(--color-stone-300);
          width: 0;
          height: 30px;
        }

        /* Remove top connector from first child */
        .css-tree ul:first-child > li {
          padding-top: 0px;
        }
        .css-tree ul:first-child > li::before {
          display: none;
        }

        /* Remove left connector from first child and right connector from last child */
        .css-tree li:first-child::before, .css-tree li:last-child::after {
          border: 0 none;
        }

        /* Add back the vertical connector to the last nodes */
        .css-tree li:last-child::before {
          border-right: 2px solid var(--color-stone-300);
          border-radius: 0 12px 0 0;
        }
        .css-tree li:first-child::after {
          border-radius: 12px 0 0 0;
        }

        /* Downward connectors from parents */
        .css-tree ul ul::before {
          content: '';
          position: absolute; top: 0; left: 50%;
          border-left: 2px solid var(--color-stone-300);
          width: 0; height: 30px;
        }
      `
          }}
        />

        {/* 
        Use w-max to prevent wrapping and allow scrolling. 
        mx-auto centers it if smaller than screen. 
        p-8 adds padding inside scroll area.
      */}
        <div
          id='export-container'
          className={`css-tree mx-auto w-max min-w-full p-4 transition-[transform,opacity] duration-200 ${isDragging ? 'opacity-90' : ''}`}
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'top center'
          }}>
          <ul>{treeContent}</ul>
        </div>
      </div>
    </div>
  )
}
