import type { Person, Relationship } from '@/types'
import type { IntakePersonData } from '@/types/intake'

export interface BranchTreePreview {
  branch: FamilyBranch
  persons: Person[]
  relationships: Relationship[]
  rootIds: string[]
}

export interface FamilyBranch {
  id: string
  name: string
  anchor_person_id: string
  partner_person_id?: string | null
  root_person_id: string | null
  created_at: string
  updated_at: string
}

export interface FamilyBranchMember {
  branch_id: string
  person_id: string
  generation: number | null
}

export type BranchRelation = 'member' | 'parent' | 'child' | 'spouse'
export type BranchPersonPayload = IntakePersonData

export interface BranchPersonOption {
  id: string
  full_name: string
  birth_year: number | null
}
