'use client'

import PhotoSwipeLightbox from 'photoswipe/lightbox'

import 'photoswipe/style.css'

import { useEffect, useRef, type ReactNode } from 'react'

import { mediaText } from '@/lib/i18n/media'

/** Scoped bindings, safe text captions, and lazy dimensions for legacy photos. */
export default function PhotoGallery({
  children,
  className = '',
  locale = 'vi'
}: {
  children: ReactNode
  className?: string
  locale?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const t = mediaText(locale)
    const lightbox = new PhotoSwipeLightbox({
      gallery: container,
      children: 'a[data-photo-view]',
      pswpModule: () => import('photoswipe'),
      showHideAnimationType: 'fade',
      closeTitle: t.close,
      zoomTitle: t.zoom,
      arrowPrevTitle: t.previous,
      arrowNextTitle: t.next,
      errorMsg: t.error,
      preload: [1, 1],
      padding: { top: 48, bottom: 64, left: 16, right: 16 }
    })
    const pending = new Set<HTMLImageElement>()
    lightbox.addFilter('itemData', (data) => {
      const anchor = data.element as HTMLAnchorElement | undefined
      const image = anchor?.querySelector('img')
      const width =
        Number(anchor?.dataset.pswpWidth) || image?.naturalWidth || 0
      const height =
        Number(anchor?.dataset.pswpHeight) || image?.naturalHeight || 0
      return {
        ...data,
        type: 'image',
        width: width || 1000,
        height: height || 1000,
        missingSize: !width || !height
      }
    })
    lightbox.on('contentLoad', (event) => {
      const content = event.content
      if (!content.data.missingSize) return
      event.preventDefault()
      const image = new Image()
      pending.add(image)
      image.onload = () => {
        pending.delete(image)
        const anchor = content.data.element as HTMLAnchorElement | undefined
        if (anchor) {
          anchor.dataset.pswpWidth = String(image.naturalWidth)
          anchor.dataset.pswpHeight = String(image.naturalHeight)
        }
        content.data.width = content.width = image.naturalWidth
        content.data.height = content.height = image.naturalHeight
        content.data.missingSize = false
        if (lightbox.pswp) lightbox.pswp.refreshSlideContent(content.index)
        else content.load(false, true)
      }
      image.onerror = () => {
        pending.delete(image)
        content.onError()
      }
      image.src = content.data.src || ''
    })
    lightbox.on('uiRegister', () => {
      const pswp = lightbox.pswp
      pswp?.ui?.registerElement({
        name: 'safe-caption',
        order: 9,
        isButton: false,
        appendTo: 'root',
        onInit: (element) => {
          const update = () => {
            const anchor = pswp.currSlide?.data.element as
              HTMLAnchorElement | undefined
            element.textContent =
              anchor?.dataset.caption || anchor?.querySelector('img')?.alt || ''
          }
          pswp.on('change', update)
          update()
        }
      })
    })
    lightbox.init()
    return () => {
      for (const image of pending) {
        image.onload = image.onerror = null
        image.src = ''
      }
      pending.clear()
      lightbox.destroy()
    }
  }, [locale])
  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  )
}
