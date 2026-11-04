import { notFound } from 'next/navigation'

import ContentEditor from '@/components/content/ContentEditor'
import { CONTENT_UUID } from '@/utils/content'
import { getContentEntry, getContentImages } from '@/utils/supabase/content'
import {
  getContentEditorName,
  requireContentEditor
} from '@/utils/supabase/content-editor'

export default async function EditContentPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  await requireContentEditor()
  const { id } = await params
  if (!CONTENT_UUID.test(id)) notFound()
  const entry = await getContentEntry(id, true)
  if (!entry || entry.deleted_at) notFound()
  const [{ images }, editorName] = await Promise.all([
    getContentImages(id),
    getContentEditorName(entry.updated_by)
  ])
  return (
    <ContentEditor
      key={entry.id}
      initial={entry}
      images={images}
      editorName={editorName}
    />
  )
}
