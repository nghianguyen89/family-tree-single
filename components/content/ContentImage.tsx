/* eslint-disable @next/next/no-img-element -- Authenticated image proxy must not use the shared Next image cache. */
import type { ContentImage as ImageRecord } from '@/types/content'
import { contentImageUrl } from '@/utils/content'

export default function ContentImage({
  image,
  className = '',
  eager = false
}: {
  image: Pick<ImageRecord, 'id' | 'alt'>
  className?: string
  eager?: boolean
}) {
  return (
    <img
      src={contentImageUrl(image.id)}
      alt={image.alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding='async'
      className={className}
    />
  )
}
