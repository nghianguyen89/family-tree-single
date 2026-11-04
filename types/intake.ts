import { Person } from '@/types'

export type MemorialDate = {
  memorial_day?: number | null
  memorial_month?: number | null
  memorial_calendar?: 'lunar' | 'solar' | null
  memorial_is_leap_month?: boolean
  memorial_note?: string | null
}

export type IntakePersonData = Pick<Person, 'full_name' | 'gender'> &
  Partial<
    Pick<
      Person,
      | 'birth_year'
      | 'birth_month'
      | 'birth_day'
      | 'birth_year_from'
      | 'birth_year_to'
      | 'death_year'
      | 'death_month'
      | 'death_day'
      | 'death_year_from'
      | 'death_year_to'
      | 'death_lunar_year'
      | 'death_lunar_month'
      | 'death_lunar_day'
      | 'is_deceased'
      | 'other_names'
      | 'note'
    >
  > &
  MemorialDate

export interface IntakePerson {
  client_id: string
  relation: 'child' | 'spouse' | 'self'
  relative_to: string
  other_parent_ref?: string | null
  data: IntakePersonData
  existing_person_id?: string | null
  update_existing?: boolean
  confirm_new?: boolean
  generation?: number | null
}

export interface IntakePayload {
  anchor_id: string
  sender_name: string
  sender_contact: string
  note: string
  people: IntakePerson[]
}

export interface IntakeOptions {
  title: string
  root_id: string
  people: Array<{ id: string; full_name: string; generation: number | null }>
}

export interface IntakeLink {
  id: string
  share_token: string | null
  title: string
  root_person_id: string
  is_active: boolean
  expires_at: string
  created_at: string
}

export interface IntakeSubmission {
  id: string
  link_id: string
  payload: IntakePayload
  reviewed_payload?: IntakePayload | null
  status: 'pending' | 'needs_info' | 'approved' | 'rejected'
  reviewer_note: string | null
  created_at: string
  reviewed_at: string | null
  approved_person_ids: string[] | null
}
