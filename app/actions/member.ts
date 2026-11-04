'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getServerTranslations } from '@/lib/i18n/server'
import { getProfile, getSupabase } from '@/utils/supabase/queries'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function deleteMemberProfile(memberId: string) {
  const { t } = await getServerTranslations()
  if (!UUID_PATTERN.test(memberId)) {
    return { error: t('invalidProfile') }
  }

  const profile = await getProfile()
  const supabase = await getSupabase()

  if (
    !profile?.is_active ||
    (profile.role !== 'admin' && profile.role !== 'editor')
  ) {
    return {
      error: t('memberDeleteAccessDenied')
    }
  }

  // 2. Check for existing relationships
  const { data: relationships, error: relationshipError } = await supabase
    .from('relationships')
    .select('id')
    .or(`person_a.eq.${memberId},person_b.eq.${memberId}`)
    .limit(1)

  if (relationshipError) {
    console.error('Error checking relationships:', relationshipError)
    return { error: t('relationshipCheckError') }
  }

  if (relationships && relationships.length > 0) {
    return {
      error: t('memberHasRelationships')
    }
  }

  // 3. Delete the member
  const { error: deleteError } = await supabase
    .from('persons')
    .delete()
    .eq('id', memberId)

  if (deleteError) {
    console.error('Error deleting person:', deleteError)
    return { error: t('memberDeleteError') }
  }

  // 4. Revalidate and redirect
  revalidatePath('/dashboard/members')
  redirect('/dashboard/members')
}

export async function updateDescendantGenerationsAction(
  personId: string,
  generationDelta: number
) {
  const { t } = await getServerTranslations()
  if (!UUID_PATTERN.test(personId)) {
    return { error: t('invalidProfile') }
  }

  if (
    generationDelta === 0 ||
    !Number.isInteger(generationDelta) ||
    Math.abs(generationDelta) > 100
  ) {
    return generationDelta === 0
      ? { success: true }
      : { error: t('invalidGenerationDelta') }
  }

  const profile = await getProfile()
  const supabase = await getSupabase()

  if (
    !profile?.is_active ||
    (profile.role !== 'admin' && profile.role !== 'editor')
  ) {
    return {
      error: t('memberEditAccessDenied')
    }
  }

  const { error } = await supabase.rpc('update_descendant_generations', {
    person_id: personId,
    generation_delta: generationDelta
  })
  if (error) {
    console.error('Error updating descendant generations:', error)
    return { error: t('descendantGenerationUpdateError') }
  }
  return { success: true }
}
