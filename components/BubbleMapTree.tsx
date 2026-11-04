'use client'

import * as d3 from 'd3'
import { Maximize2, Minimize2, Minus, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import BranchNodeLinks from '@/components/branches/BranchNodeLinks'
import { useMemberListView } from '@/context/MemberListContext'
import { branchesMessages } from '@/lib/i18n/branches'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { Person, Relationship } from '@/types'
import { getAvatarUrl } from '@/utils/avatar'
import { buildAdjacencyLists, getFilteredTreeData } from '@/utils/treeHelpers'

import { AVATAR_VERSION } from './DefaultAvatar'

export interface BubbleMapTreeProps {
  personsMap: Map<string, Person>
  relationships: Relationship[]
  roots: Person[]
  canEdit?: boolean
}

// Define D3 Node and Link types
interface GraphNode extends d3.SimulationNodeDatum {
  id: string
  people: Person[] // [main, ...spouses]
  radius: number
  width: number
  isRoot: boolean
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  type: string
}

const showAvatar = true

export default function BubbleMapTree({
  personsMap,
  relationships,
  roots
}: BubbleMapTreeProps) {
  const { t, locale } = useI18n()
  const { branches } = useMemberListView()
  const containerRef = useRef<HTMLDivElement>(null)
  const fullscreenRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [isFullscreen, setIsFullscreen] = useState(false)
  // const { showAvatar } = useMemberListView();

  const adj = useMemo(
    () => buildAdjacencyLists(relationships, personsMap),
    [relationships, personsMap]
  )

  // Build graph data (Group spouses into a single 'Family Unit' node)
  const { nodes, links } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>()
    const linkArray: GraphLink[] = []

    const addFamilyUnit = (
      mainPerson: Person,
      spouses: Person[],
      isRoot: boolean
    ) => {
      if (!nodeMap.has(mainPerson.id)) {
        const people = [mainPerson, ...spouses]
        const radius = isRoot ? 40 : 30
        // Width expands for each additional spouse
        const width = radius * 2 + (people.length - 1) * (radius * 1.5)

        nodeMap.set(mainPerson.id, {
          id: mainPerson.id,
          people,
          radius,
          width,
          isRoot
        })
      }
    }

    const walk = (personId: string, visited: Set<string>) => {
      if (visited.has(personId)) return
      visited.add(personId)

      const data = getFilteredTreeData(personId, personsMap, adj, {
        hideDaughtersInLaw: false,
        hideSonsInLaw: false,
        hideDaughters: false,
        hideSons: false,
        hideMales: false,
        hideFemales: false
      })

      if (!data.person) return

      const spouses = data.spouses.map((s) => s.person)
      addFamilyUnit(
        data.person,
        spouses,
        roots.some((r) => r.id === personId)
      )

      data.children.forEach((child) => {
        // Link the Parent FamilyUnit -> Child FamilyUnit
        linkArray.push({
          source: personId,
          target: child.id,
          type: 'child'
        })
        walk(child.id, new Set(visited))
      })
    }

    roots.forEach((root) => walk(root.id, new Set()))

    return { nodes: Array.from(nodeMap.values()), links: linkArray }
  }, [roots, personsMap, adj])

  const effectiveSelectedNodeId =
    selectedNodeId && nodes.some((node) => node.id === selectedNodeId)
      ? selectedNodeId
      : null

  // Resolve descendants from the raw relationships. D3 mutates link
  // endpoints into GraphNode objects once the simulation starts.
  const highlightedNodeIds = useMemo(() => {
    if (!effectiveSelectedNodeId) return null

    const childrenByParent = new Map<string, string[]>()
    relationships.forEach((relationship) => {
      if (
        relationship.type !== 'biological_child' &&
        relationship.type !== 'adopted_child'
      ) {
        return
      }

      const children = childrenByParent.get(relationship.person_a) || []
      children.push(relationship.person_b)
      childrenByParent.set(relationship.person_a, children)
    })

    const descendantIds = new Set<string>([effectiveSelectedNodeId])
    const queue = [effectiveSelectedNodeId]

    while (queue.length > 0) {
      const parentId = queue.shift()!
      const children = childrenByParent.get(parentId) || []

      children.forEach((childId) => {
        if (!descendantIds.has(childId)) {
          descendantIds.add(childId)
          queue.push(childId)
        }
      })
    }

    return descendantIds
  }, [effectiveSelectedNodeId, relationships])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === fullscreenRef.current)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () =>
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return

    try {
      const width = containerRef.current.clientWidth
      const height = containerRef.current.clientHeight

      // Pin root nodes to the center
      const rootNodes = nodes.filter((n) => n.isRoot)
      if (rootNodes.length === 1) {
        rootNodes[0].fx = width / 2
        rootNodes[0].fy = height / 2
      } else if (rootNodes.length > 1) {
        rootNodes.forEach((n, i) => {
          n.fx = width / 2 + (i - (rootNodes.length - 1) / 2) * 150
          n.fy = height / 2
        })
      }

      const svg = d3
        .select(svgRef.current)
        .attr('viewBox', [0, 0, width, height])
        .style('cursor', 'grab')
      svg.selectAll('*').remove() // Clear previous render

      const g = svg.append('g')

      // Defs for avatar clipping
      const defs = svg.append('defs')
      defs
        .append('clipPath')
        .attr('id', 'avatar-clip')
        .append('circle')
        .attr('r', 26)
        .attr('cx', 0)
        .attr('cy', 0)
      defs
        .append('clipPath')
        .attr('id', 'avatar-clip-root')
        .append('circle')
        .attr('r', 36)
        .attr('cx', 0)
        .attr('cy', 0)

      // Zoom setup
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
          g.attr('transform', event.transform)
          // Only re-render React when the displayed percentage changes
          const k = Math.round(event.transform.k * 100) / 100
          setZoomLevel((prev) => (prev === k ? prev : k))
        })
      zoomRef.current = zoom
      svg.call(
        zoom as unknown as (
          selection: d3.Selection<SVGSVGElement, unknown, null, undefined>
        ) => void
      )

      svg.on('click', (event) => {
        if (event.target === svgRef.current) {
          setSelectedNodeId(null)
        }
      })

      // Initial center transform
      svg.call(
        zoom.translateTo as unknown as (
          selection: d3.Selection<SVGSVGElement, unknown, null, undefined>,
          x: number,
          y: number
        ) => void,
        width / 2,
        height / 2
      )

      // Force simulation
      const simulation = d3
        .forceSimulation<GraphNode>(nodes)
        .force(
          'link',
          d3
            .forceLink<GraphNode, GraphLink>(links)
            .id((d) => d.id)
            .distance(150)
        )
        .force('charge', d3.forceManyBody().strength(-1200))
        // Use width / 2 as the collision radius to prevent overlapping of the wider family units
        .force(
          'collide',
          d3
            .forceCollide<GraphNode>()
            .radius((d) => d.width / 2 + 15)
            .iterations(2)
        )

      // Large families: settle faster so the layout stops moving sooner
      if (nodes.length > 300) {
        simulation.alphaDecay(nodes.length > 1000 ? 0.06 : 0.04)
      }

      // Draw links
      const link = g
        .append('g')
        .attr('stroke-opacity', 0.6)
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('class', 'bubble-link')
        .attr('stroke', 'var(--color-stone-300)')
        .attr('stroke-width', 2)

      // Draw nodes (Family Units)
      const node = g
        .append('g')
        .selectAll('g')
        .data(nodes)
        .join('g')
        .attr('class', 'bubble-node')
        .style('cursor', 'pointer')
        .on('click', (event, d) => {
          if (event.defaultPrevented) return

          if (d.x != null && d.y != null) {
            svg.transition().duration(450).call(zoom.translateTo, d.x, d.y)
          }

          setSelectedNodeId((currentId) => (currentId === d.id ? null : d.id))
        })
        .call(
          d3
            .drag<SVGGElement, GraphNode>()
            .on('start', (event, d) => {
              if (!event.active) simulation.alphaTarget(0.3).restart()
              d.fx = d.x
              d.fy = d.y
              svg.style('cursor', 'grabbing')
            })
            .on('drag', (event, d) => {
              d.fx = event.x
              d.fy = event.y
            })
            .on('end', (event, d) => {
              if (!event.active) simulation.alphaTarget(0)
              if (!d.isRoot) {
                d.fx = null
                d.fy = null
              }
              svg.style('cursor', 'grab')
            }) as never
        )

      // Pill shape for the Family Unit
      node
        .append('rect')
        .attr('x', (d) => -d.width / 2)
        .attr('y', (d) => -d.radius)
        .attr('rx', (d) => d.radius)
        .attr('ry', (d) => d.radius)
        .attr('width', (d) => d.width)
        .attr('height', (d) => d.radius * 2)
        .attr('fill', 'var(--color-surface)')
        .attr('stroke', (d) =>
          d.people[0].gender === 'male' ? '#3b82f6' : '#ec4899'
        )
        .attr('stroke-width', (d) => (d.isRoot ? 4 : 2))
        .attr(
          'class',
          'shadow-md transition-all hover:scale-105 cursor-pointer'
        )

      // Avatars for everyone in the Family Unit
      if (showAvatar) {
        node.each(function (d) {
          const unitContent = d3.select(this)

          d.people.forEach((person, index) => {
            // Calculate X offset for each avatar inside the pill
            // If 1 person (width = radius*2): offset = 0
            // If 2 people: spacing = radius*1.5. Offsets = -0.75*r, +0.75*r
            const totalSpacing = d.width - d.radius * 2
            const spacingStep =
              d.people.length > 1 ? totalSpacing / (d.people.length - 1) : 0
            const startX = -(totalSpacing / 2)
            const cx = startX + index * spacingStep

            const avatarGroup = unitContent
              .append('g')
              .attr('transform', `translate(${cx}, 0)`)

            avatarGroup
              .append('image')
              .attr('x', -d.radius + 4)
              .attr('y', -d.radius + 4)
              .attr('width', (d.radius - 4) * 2)
              .attr('height', (d.radius - 4) * 2)
              .attr(
                'clip-path',
                d.isRoot ? 'url(#avatar-clip-root)' : 'url(#avatar-clip)'
              )
              .attr('preserveAspectRatio', 'xMidYMid slice')
              .attr(
                'href',
                getAvatarUrl(person.avatar_url) ||
                  (person.gender === 'male'
                    ? `/avatar/${AVATAR_VERSION}/male.svg`
                    : `/avatar/${AVATAR_VERSION}/female.svg`)
              )
          })
        })
      }

      // Node text (concatenated names)
      node
        .append('text')
        .attr('dy', (d) => d.radius + 18)
        .attr('text-anchor', 'middle')
        .attr('fill', 'var(--color-secondary)')
        .attr('font-size', (d) => (d.isRoot ? '14px' : '12px'))
        .attr('font-weight', (d) => (d.isRoot ? 'bold' : 'normal'))
        .style('pointer-events', 'none')
        .text((d) =>
          d.people.map((p) => p.full_name.split(' ').pop()).join(' & ')
        )

      simulation.on('tick', () => {
        link
          .attr('x1', (d) => (d.source as GraphNode).x!)
          .attr('y1', (d) => (d.source as GraphNode).y!)
          .attr('x2', (d) => (d.target as GraphNode).x!)
          .attr('y2', (d) => (d.target as GraphNode).y!)

        node.attr('transform', (d) => `translate(${d.x},${d.y})`)
      })

      return () => {
        simulation.stop()
        zoomRef.current = null
      }
    } catch (err) {
      console.error('D3 rendering error:', err)
      const errorToDisplay =
        err instanceof Error ? err : new Error('Unknown error')
      requestAnimationFrame(() => setError(errorToDisplay))
    }
  }, [isFullscreen, nodes, links])

  // Update visual emphasis without rebuilding the force simulation.
  useEffect(() => {
    if (!svgRef.current) return

    const getNodeId = (endpoint: string | GraphNode) =>
      typeof endpoint === 'string' ? endpoint : endpoint.id

    const svg = d3.select(svgRef.current)
    const nodeSelection = svg.selectAll<SVGGElement, GraphNode>('.bubble-node')
    const linkSelection = svg.selectAll<SVGLineElement, GraphLink>(
      '.bubble-link'
    )

    nodeSelection
      .transition()
      .duration(250)
      .style('opacity', (node) =>
        highlightedNodeIds && !highlightedNodeIds.has(node.id) ? 0.16 : 1
      )

    nodeSelection
      .select<SVGRectElement>('rect')
      .transition()
      .duration(250)
      .attr('fill', (node) =>
        effectiveSelectedNodeId === node.id
          ? 'var(--color-amber-50)'
          : 'var(--color-surface)'
      )
      .attr('stroke', (node) => {
        if (effectiveSelectedNodeId === node.id) return 'var(--color-tertiary)'
        return node.people[0].gender === 'male' ? '#3b82f6' : '#ec4899'
      })
      .attr('stroke-width', (node) => {
        if (effectiveSelectedNodeId === node.id) return node.isRoot ? 6 : 4
        return node.isRoot ? 4 : 2
      })

    linkSelection
      .transition()
      .duration(250)
      .attr('stroke-opacity', (link) => {
        if (!highlightedNodeIds) return 0.6

        const sourceId = getNodeId(link.source as string | GraphNode)
        const targetId = getNodeId(link.target as string | GraphNode)
        const isHighlighted =
          highlightedNodeIds.has(sourceId) && highlightedNodeIds.has(targetId)

        return isHighlighted ? 0.9 : 0.08
      })
      .attr('stroke', (link) => {
        if (!highlightedNodeIds) return 'var(--color-stone-300)'

        const sourceId = getNodeId(link.source as string | GraphNode)
        const targetId = getNodeId(link.target as string | GraphNode)
        const isHighlighted =
          highlightedNodeIds.has(sourceId) && highlightedNodeIds.has(targetId)

        return isHighlighted
          ? 'var(--color-tertiary)'
          : 'var(--color-stone-300)'
      })
      .attr('stroke-width', (link) => {
        if (!highlightedNodeIds) return 2

        const sourceId = getNodeId(link.source as string | GraphNode)
        const targetId = getNodeId(link.target as string | GraphNode)
        const isHighlighted =
          highlightedNodeIds.has(sourceId) && highlightedNodeIds.has(targetId)

        return isHighlighted ? 3 : 2
      })
  }, [effectiveSelectedNodeId, highlightedNodeIds])

  useEffect(() => {
    if (!svgRef.current) return
    const anchors = new Set(branches.map((branch) => branch.anchor_person_id))
    const nodeSelection = d3
      .select(svgRef.current)
      .selectAll<SVGGElement, GraphNode>('.bubble-node')
    nodeSelection.selectAll('.auxiliary-marker').remove()
    nodeSelection
      .filter((node) => node.people.some((person) => anchors.has(person.id)))
      .append('circle')
      .attr('class', 'auxiliary-marker')
      .attr('cx', (node) => node.width / 2)
      .attr('cy', (node) => -node.radius)
      .attr('r', 6)
      .attr('fill', 'var(--color-tertiary)')
      .append('title')
      .text(branchesMessages[locale].title)
  }, [nodes, branches, locale, isFullscreen])

  const changeZoom = (nextLevel: number) => {
    if (!svgRef.current || !zoomRef.current) return

    d3.select(svgRef.current)
      .transition()
      .duration(180)
      .call(zoomRef.current.scaleTo, nextLevel)
  }

  const resetZoom = () => {
    if (!svgRef.current || !zoomRef.current) return

    d3.select(svgRef.current)
      .transition()
      .duration(220)
      .call(zoomRef.current.transform, d3.zoomIdentity)
  }

  const toggleFullscreen = async () => {
    if (!fullscreenRef.current) return

    try {
      if (document.fullscreenElement === fullscreenRef.current) {
        await document.exitFullscreen()
      } else if (!document.fullscreenElement) {
        await fullscreenRef.current.requestFullscreen()
      }
    } catch (fullscreenError) {
      console.error('Fullscreen error:', fullscreenError)
    }
  }

  if (error) {
    return (
      <div className='absolute inset-0 flex items-center justify-center overflow-hidden rounded-2xl border border-stone-200/60 bg-stone-50 p-4 text-center'>
        <span className='text-stone-500'>
          {t('unsupportedBrowser', { error: error.message })}
        </span>
      </div>
    )
  }

  const selectedBranchPeople = nodes
    .filter((node) => node.id === effectiveSelectedNodeId)
    .flatMap((node) => node.people)
    .filter((person) =>
      branches.some((branch) => branch.anchor_person_id === person.id)
    )
  return (
    <div
      ref={fullscreenRef}
      className={`absolute inset-0 overflow-hidden bg-stone-50 ${
        isFullscreen
          ? 'rounded-none border-0'
          : 'rounded-2xl border border-stone-200/60'
      }`}>
      {selectedBranchPeople.length > 0 && (
        <div className='absolute bottom-4 left-4 z-50 max-h-[70%] overflow-auto rounded-xl bg-surface p-2'>
          {selectedBranchPeople.map((person) => (
            <BranchNodeLinks key={person.id} personId={person.id} />
          ))}
        </div>
      )}
      <div
        id='tree-toolbar-portal'
        className='absolute top-4 left-4 z-50'></div>

      <div className='absolute top-4 right-4 z-50 flex items-center gap-1 rounded-xl border border-stone-200/70 bg-surface p-1.5'>
        <button
          type='button'
          onClick={() => changeZoom(Math.max(0.1, zoomLevel - 0.1))}
          className='flex size-8 items-center justify-center rounded-lg text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 focus:ring-2 focus:ring-amber-400 focus:outline-none'
          aria-label={t('zoomOut')}
          title={t('zoomOut')}>
          <Minus className='size-4' />
        </button>
        <input
          type='range'
          min='0.1'
          max='4'
          step='0.1'
          value={zoomLevel}
          onChange={(event) => changeZoom(Number(event.currentTarget.value))}
          className='h-1.5 w-20 cursor-pointer accent-amber-600 sm:w-28'
          aria-label={t('zoomLevel')}
          title={t('zoomLevel')}
        />
        <span className='w-10 text-center text-sm font-medium text-stone-500 tabular-nums'>
          {Math.round(zoomLevel * 100)}%
        </span>
        <button
          type='button'
          onClick={() => changeZoom(Math.min(4, zoomLevel + 0.1))}
          className='flex size-8 items-center justify-center rounded-lg text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 focus:ring-2 focus:ring-amber-400 focus:outline-none'
          aria-label={t('zoomIn')}
          title={t('zoomIn')}>
          <Plus className='size-4' />
        </button>
        <div className='mx-0.5 h-5 w-px bg-stone-200' aria-hidden='true' />
        <button
          type='button'
          onClick={resetZoom}
          className='flex size-8 items-center justify-center rounded-lg text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 focus:ring-2 focus:ring-amber-400 focus:outline-none'
          aria-label={t('resetZoomLevel')}
          title={t('resetZoomLevel')}>
          <RotateCcw className='size-4' />
        </button>
        <div className='mx-0.5 h-5 w-px bg-stone-200' aria-hidden='true' />
        <button
          type='button'
          onClick={toggleFullscreen}
          className='flex size-8 items-center justify-center rounded-lg text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 focus:ring-2 focus:ring-amber-400 focus:outline-none'
          aria-label={isFullscreen ? t('exitFullscreen') : t('fullscreen')}
          aria-pressed={isFullscreen}
          title={isFullscreen ? t('exitFullscreen') : t('fullscreen')}>
          {isFullscreen ? (
            <Minimize2 className='size-4' />
          ) : (
            <Maximize2 className='size-4' />
          )}
        </button>
      </div>

      <div ref={containerRef} className='h-full w-full'>
        <svg ref={svgRef} className='block h-full w-full' />
      </div>
    </div>
  )
}
