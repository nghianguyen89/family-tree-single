export type Gender = 'male' | 'female' | 'other'
export type RelationshipType = 'marriage' | 'biological_child' | 'adopted_child'
export type UserRole = 'admin' | 'editor' | 'member'

export interface Profile {
  id: string
  is_shared_viewer?: boolean
  person_id?: string | null
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AdminUserData {
  id: string
  is_shared_viewer?: boolean
  person_id?: string | null
  email: string
  role: UserRole
  is_active: boolean
  created_at: string
}

export interface Person {
  id: string
  /** Null for the main family; shared profiles join auxiliary branches separately. */
  family_branch_id?: string | null
  full_name: string
  gender: Gender
  memorial_day?: number | null
  memorial_month?: number | null
  memorial_calendar?: 'lunar' | 'solar' | null
  memorial_is_leap_month?: boolean
  memorial_note?: string | null
  birth_year_from?: number | null
  birth_year_to?: number | null
  death_year_from?: number | null
  death_year_to?: number | null
  birth_year: number | null
  birth_month: number | null
  birth_day: number | null
  death_year: number | null
  death_month: number | null
  death_day: number | null
  avatar_url: string | null
  note: string | null
  created_at: string
  updated_at: string

  // Private fields (optional, as they might not be returned for members)
  phone_number?: string | null
  occupation?: string | null
  current_residence?: string | null

  // Lunar Date
  death_lunar_year: number | null
  death_lunar_month: number | null
  death_lunar_day: number | null

  // New fields
  is_deceased: boolean
  is_in_law: boolean
  birth_order: number | null
  generation: number | null
  other_names: string | null
}

export interface Relationship {
  id: string
  /** Null for main-family relationships. */
  family_branch_id?: string | null
  type: RelationshipType
  person_a: string // UUID
  person_b: string // UUID
  note?: string | null
  created_at: string
  updated_at: string
}

// Helper types for UI
export interface PersonWithDetails extends Person {
  spouses?: Person[]
  children?: Person[]
  parents?: Person[]
}

export interface GalleryItem {
  id: string
  title: string
  description: string | null
  image_url: string
  event_date: string | null // ISO string or date string
  created_at: string
  created_by: string | null
  // Storage path used to create signed URLs and delete the object.
  storage_path?: string
}
