export type ContentKind = 'article' | 'announcement' | 'album'
export type ContentStatus = 'draft' | 'published'
export type ContentVisibility = 'public' | 'internal'
export type HomeSection = 'announcements' | 'articles' | 'albums'

export interface ContentInput {
  kind: ContentKind
  title: string
  summary: string
  body: string
  category: string
  status: ContentStatus
  visibility: ContentVisibility
  is_featured: boolean
  publish_at: string | null
  expires_at: string | null
  event_start: string | null
  event_end: string | null
  location: string
}

export interface ContentEntry extends ContentInput {
  id: string
  revision: number
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export interface ContentImage {
  asset_id?: string | null
  id: string
  entry_id: string | null
  storage_path: string
  alt: string
  caption: string
  position: number
}

export interface HomeSettings {
  id: number
  title: string
  subtitle: string
  origin: string
  origin_previous?: string
  introduction: string
  contact: string
  cover_image_id: string | null
  section_order: HomeSection[]
  revision: number
  updated_at?: string
  updated_by?: string | null
}
