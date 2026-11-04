import { isContentUploadSameOrigin } from '@/utils/content-upload'
import {
  MAX_BACKUP_BYTES,
  MAX_BACKUP_REQUEST_BYTES
} from '@/utils/full-backup-archive'
import {
  assertBackupOperator,
  exportWebsiteBackup,
  fullBackupAvailability,
  inspectWebsiteBackup,
  restoreWebsiteBackup
} from '@/utils/full-backup-server'
import { getProfile } from '@/utils/supabase/queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff'
}
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers })

export async function GET() {
  const profile = await getProfile()
  if (!profile?.is_active || profile.role !== 'admin')
    return json(
      { error: 'Chỉ admin đang hoạt động được sử dụng chức năng này.' },
      403
    )
  return json(fullBackupAvailability())
}

export async function POST(request: Request) {
  if (!isContentUploadSameOrigin(request))
    return json({ error: 'Yêu cầu không cùng website.' }, 403)
  const profile = await getProfile()
  if (!profile?.is_active || profile.role !== 'admin')
    return json(
      { error: 'Chỉ admin đang hoạt động được sử dụng chức năng này.' },
      403
    )
  try {
    assertBackupOperator(profile.id)
    const maximum = MAX_BACKUP_REQUEST_BYTES
    if (Number(request.headers.get('content-length')) > maximum)
      return json({ error: 'File vượt giới hạn 128 MiB.' }, 413)
    const reader = request.body?.getReader()
    if (!reader) return json({ error: 'Thiếu dữ liệu yêu cầu.' }, 400)
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let length = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maximum) {
        await reader.cancel()
        return json({ error: 'File vượt giới hạn 128 MiB.' }, 413)
      }
      chunks.push(new Uint8Array(value))
    }
    const form = await new Response(new Blob(chunks), {
      headers: { 'Content-Type': request.headers.get('content-type') || '' }
    }).formData()
    const password = String(form.get('password') || '')
    if (password.length < 12 || password.length > 256)
      return json(
        { error: 'Mật khẩu bản sao lưu cần từ 12 đến 256 ký tự.' },
        400
      )
    const action = String(form.get('action'))
    if (action === 'export') {
      const source = String(form.get('source'))
      if (!['current', 'external'].includes(source))
        return json({ error: 'Nguồn sao lưu không hợp lệ.' }, 400)
      const bytes = await exportWebsiteBackup(password, source === 'external')
      return new Response(new Uint8Array(bytes), {
        headers: {
          ...headers,
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="family-website-${new Date().toISOString().slice(0, 10)}.ftbackup"`
        }
      })
    }
    if (!['inspect', 'restore'].includes(action))
      return json({ error: 'Thao tác không hợp lệ.' }, 400)
    const file = form.get('file')
    if (!(file instanceof File) || !file.size || file.size > MAX_BACKUP_BYTES)
      return json(
        { error: 'File sao lưu không hợp lệ hoặc vượt giới hạn.' },
        400
      )
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (action === 'inspect')
      return json(await inspectWebsiteBackup(bytes, password, profile.id))
    return json(
      await restoreWebsiteBackup(
        bytes,
        password,
        profile.id,
        String(form.get('token') || ''),
        String(form.get('confirmation') || ''),
        form.get('acceptAdminMapping') === 'true'
      )
    )
  } catch (error) {
    // Never expose SQL errors, archive rows, password hashes or credentials.
    const message = error instanceof Error ? error.message : ''
    const safe =
      /^(Bản |Project |Có tài khoản |Tài khoản |Chưa |Thiếu |Môi trường |Không |Vui lòng |File |Dữ liệu |Cấu hình |Mật khẩu |Nơi nhận )/.test(
        message
      )
    return json(
      {
        error: safe
          ? message
          : 'Không thể xử lý bản sao lưu. Kiểm tra mật khẩu, file và schema của hai project; chưa xác nhận khôi phục thành công.'
      },
      400
    )
  }
}
