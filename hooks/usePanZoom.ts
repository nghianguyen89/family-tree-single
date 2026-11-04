import { MouseEvent, useCallback, useEffect, useRef, useState } from 'react'

const MIN_SCALE = 0.3
const MAX_SCALE = 2
const clampScale = (s: number) =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(s * 100) / 100))

export function usePanZoom(
  containerRef: React.RefObject<HTMLDivElement | null>
) {
  const [isPressed, setIsPressed] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const hasDraggedRef = useRef(false)
  // Drag bookkeeping lives in refs: it changes on every mouse event and must
  // not trigger re-renders of the (potentially huge) tree.
  const dragStartRef = useRef({ x: 0, y: 0 })
  const scrollStartRef = useRef({ left: 0, top: 0 })
  const [scale, setScale] = useState(1)

  const handleZoomIn = useCallback(
    () => setScale((s) => clampScale(s + 0.1)),
    []
  )
  const handleZoomOut = useCallback(
    () => setScale((s) => clampScale(s - 0.1)),
    []
  )
  const handleResetZoom = useCallback(() => setScale(1), [])

  // Trackpad pinch (reported as ctrl+wheel) and Ctrl/⌘ + scroll zoom.
  // Plain scrolling keeps panning the canvas as before.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setScale((s) => clampScale(s * Math.exp(-e.deltaY * 0.01)))
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [containerRef])

  const handleMouseDown = (e: MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return
    setIsPressed(true)
    hasDraggedRef.current = false
    dragStartRef.current = { x: e.pageX, y: e.pageY }
    if (containerRef.current) {
      scrollStartRef.current = {
        left: containerRef.current.scrollLeft,
        top: containerRef.current.scrollTop
      }
    }
  }

  const handleMouseMove = (e: MouseEvent<HTMLElement>) => {
    if (!isPressed || !containerRef.current) return

    // Only start dragging if moved a bit to allow simple clicks
    const dx = e.pageX - dragStartRef.current.x
    const dy = e.pageY - dragStartRef.current.y

    if (!hasDraggedRef.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      setIsDragging(true)
      hasDraggedRef.current = true
    }

    if (hasDraggedRef.current) {
      e.preventDefault()
      containerRef.current.scrollLeft = scrollStartRef.current.left - dx
      containerRef.current.scrollTop = scrollStartRef.current.top - dy
    }
  }

  const handleMouseUpOrLeave = () => {
    setIsPressed(false)
    setIsDragging(false)
  }

  const handleClickCapture = (e: MouseEvent<HTMLElement>) => {
    // Intercept clicks if we were dragging, prevent links from opening
    if (hasDraggedRef.current) {
      e.stopPropagation()
      e.preventDefault()
      hasDraggedRef.current = false
    }
  }

  return {
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
  }
}
