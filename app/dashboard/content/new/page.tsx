import ContentEditor from '@/components/content/ContentEditor'
import { requireContentEditor } from '@/utils/supabase/content-editor'

export default async function NewContentPage() {
  await requireContentEditor()
  return <ContentEditor />
}
