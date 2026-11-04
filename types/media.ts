export interface MediaAsset {
  id: string
  title: string
  description: string
  event_date: string | null
  width: number | null
  height: number | null
  library_visible: boolean
  created_at: string
  created_by: string | null
}
export const mediaImageUrl = (id: string) =>
  `/api/media/image?id=${encodeURIComponent(id)}`
