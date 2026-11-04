'use client'

import { Download, ShieldCheck, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useI18n } from '@/lib/i18n/I18nProvider'

interface Availability {
  enabled: boolean
  targetProjectRef: string
  targetFamily: string
  isDemo: boolean
  sqlConfigured: boolean
  storageConfigured: boolean
  operatorConfigured: boolean
  externalSourceConfigured: boolean
  maxBytes: number
  explanation: string
}
interface Preview {
  createdAt: string
  sourceProjectRef: string
  targetProjectRef: string
  counts: Record<string, number>
  fileCount: number
  fileBytes: number
  confirmation: string
  token: string
  adminMapping: { sourceId: string; targetId: string; email: string } | null
}

export default function FullWebsiteBackup() {
  const { locale } = useI18n()
  const en = locale === 'en'
  const [status, setStatus] = useState<Availability | null>(null)
  const [source, setSource] = useState('current')
  const [password, setPassword] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [acceptAdminMapping, setAcceptAdminMapping] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/website-backup', {
      signal: controller.signal,
      cache: 'no-store'
    })
      .then(async (r) => {
        const value = await r.json()
        if (!r.ok) throw new Error(value.error)
        setStatus(value)
      })
      .catch((e) => {
        if (e.name !== 'AbortError') {
          setError(true)
          setMessage(e.message)
        }
      })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (!busy) return
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', leave)
    return () => window.removeEventListener('beforeunload', leave)
  }, [busy])
  const resetPreview = () => {
    setPreview(null)
    setConfirmation('')
    setAcceptAdminMapping(false)
    setMessage('')
  }
  const enabled =
    status?.enabled &&
    status.sqlConfigured &&
    status.storageConfigured &&
    status.operatorConfigured
  async function perform(action: 'export' | 'inspect' | 'restore') {
    if (action === 'inspect') resetPreview()
    setBusy(action)
    setMessage('')
    setError(false)
    try {
      const form = new FormData()
      form.set('action', action)
      form.set('password', password)
      form.set('source', source)
      if (action !== 'export') {
        if (!file)
          throw new Error(
            en ? 'Choose a backup file.' : 'Chọn file sao lưu trước.'
          )
        if (file.size > (status?.maxBytes || 0))
          throw new Error(
            en
              ? 'File exceeds the 128 MiB limit.'
              : 'File vượt giới hạn 128 MiB.'
          )
        form.set('file', file)
      }
      if (action === 'restore') {
        if (!preview)
          throw new Error(
            en
              ? 'Inspect the file first.'
              : 'Kiểm tra file trước khi khôi phục.'
          )
        form.set('token', preview.token)
        form.set('confirmation', confirmation)
        form.set('acceptAdminMapping', String(acceptAdminMapping))
      }
      const response = await fetch('/api/website-backup', {
        method: 'POST',
        body: form
      })
      if (!response.ok) {
        const value = await response.json()
        throw new Error(value.error)
      }
      if (action === 'export') {
        const url = URL.createObjectURL(await response.blob())
        const a = document.createElement('a')
        a.href = url
        a.download = `family-website-${new Date().toISOString().slice(0, 10)}.ftbackup`
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 30000)
        setMessage(
          en
            ? 'Encrypted backup downloaded. Keep the passphrase separately.'
            : 'Đã tải bản sao lưu mã hóa. Giữ mật khẩu riêng để khôi phục.'
        )
      } else if (action === 'inspect') {
        setPreview(await response.json())
        setConfirmation('')
        setAcceptAdminMapping(false)
      } else {
        const result = await response.json()
        setPreview(null)
        setConfirmation('')
        setPassword('')
        setMessage(
          en
            ? `Restore committed with ${result.files} files and ${result.users} source accounts. ${result.adminMapped ? 'The source admin was mapped to your destination account; keep using your destination sign-in.' : result.requiresLogin ? 'Sign in again with the restored password.' : 'Your destination admin sign-in is unchanged.'} Previous destination image files remain for recovery.`
            : `Đã khôi phục ${result.files} file và ${result.users} tài khoản nguồn. ${result.adminMapped ? 'Admin nguồn đã được ánh xạ sang tài khoản đích; tiếp tục dùng cách đăng nhập của admin đích.' : result.requiresLogin ? 'Đăng nhập lại bằng mật khẩu đã khôi phục.' : 'Thông tin đăng nhập admin đích được giữ nguyên.'} File ảnh cũ ở nơi nhận vẫn được giữ để dự phòng.`
        )
      }
    } catch (e) {
      setError(true)
      const detail =
        e instanceof Error
          ? e.message
          : en
            ? 'Operation failed.'
            : 'Thao tác không thành công.'
      setMessage(
        action === 'restore'
          ? `${
              en
                ? 'Restore outcome is unconfirmed. Check destination data and images before retrying; the database may have committed even if the response was lost.'
                : 'Chưa xác nhận kết quả khôi phục. Kiểm tra dữ liệu và ảnh ở nơi nhận trước khi thử lại; database có thể đã commit dù mất phản hồi.'
            } ${detail}`
          : detail
      )
      if (action === 'restore') {
        setPreview(null)
        setConfirmation('')
        setAcceptAdminMapping(false)
      }
    } finally {
      setBusy('')
    }
  }
  const field =
    'w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-primary disabled:opacity-50'
  const button =
    'inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-surface disabled:cursor-not-allowed disabled:opacity-50'
  return (
    <section
      aria-labelledby='website-backup-heading'
      className='mb-8 space-y-5 rounded-2xl border border-border bg-surface p-5 sm:p-6'>
      <div>
        <h2
          id='website-backup-heading'
          className='flex items-center gap-2 font-serif text-2xl font-semibold text-primary'>
          <ShieldCheck className='size-5 text-tertiary' />
          {en ? 'Full website backup' : 'Sao lưu toàn website'}
        </h2>
        <p className='mt-1 text-sm text-secondary'>
          {en
            ? 'Family tree, private details, articles, albums, intake, account passwords and the actual image files.'
            : 'Gia phả, thông tin riêng, bài viết, album, hồ sơ thu thập, tài khoản cùng mật khẩu và file ảnh thực tế.'}
        </p>
        <p className='mt-2 text-sm text-secondary'>
          {en
            ? 'Up to 128 MiB per encrypted archive; run locally or on your own server. Project configuration, login sessions and MFA are excluded. Configure OAuth and email separately.'
            : 'Tối đa 128 MiB mỗi file mã hóa; chạy trên local hoặc máy chủ riêng. Không chứa cấu hình dịch vụ, phiên đăng nhập hoặc MFA. OAuth và email cần cấu hình riêng.'}
        </p>
      </div>
      {status && (
        <div className='rounded-xl bg-neutral p-4 text-sm text-secondary'>
          <p>
            {en ? 'Destination' : 'Nơi nhận'}:{' '}
            <span className='font-medium text-primary'>
              {status.targetFamily}
            </span>{' '}
            · <code>{status.targetProjectRef}</code>
          </p>
          {status.isDemo && (
            <p className='mt-1'>
              {en
                ? 'Demo rejects archives from other projects.'
                : 'Demo chặn khôi phục bản sao lưu từ project khác.'}
            </p>
          )}
          {!status.enabled && (
            <p className='mt-2'>
              {en
                ? 'Enable WEBSITE_BACKUP_ENABLED=true on a local or self-hosted server; this feature is unavailable on Vercel.'
                : status.explanation}
            </p>
          )}
          {!status.operatorConfigured && (
            <p className='mt-2'>
              {en
                ? 'Set WEBSITE_BACKUP_OPERATOR_ID to the operating admin user ID on the server.'
                : 'Đặt WEBSITE_BACKUP_OPERATOR_ID là ID của admin vận hành trên server.'}
            </p>
          )}
          {(!status.sqlConfigured || !status.storageConfigured) && (
            <p className='mt-2'>
              {en
                ? 'Configure server SQL and service-role credentials.'
                : 'Cần cấu hình SQL và service-role phía server.'}
            </p>
          )}
        </div>
      )}
      <div className='max-w-xl'>
        <label
          htmlFor='website-backup-password'
          className='mb-1 block text-sm font-medium text-primary'>
          {en
            ? 'Archive passphrase (at least 12 characters)'
            : 'Mật khẩu bản sao lưu (ít nhất 12 ký tự)'}
        </label>
        <input
          id='website-backup-password'
          type='password'
          autoComplete='off'
          minLength={12}
          maxLength={256}
          value={password}
          disabled={!!busy}
          onChange={(e) => {
            setPassword(e.target.value)
            resetPreview()
          }}
          className={field}
        />
        <p className='mt-1 text-sm text-secondary'>
          {en
            ? 'Choose a separate passphrase when exporting; use the same one when restoring. It is not saved by the website.'
            : 'Đặt mật khẩu riêng khi tạo bản sao lưu; nhập lại đúng mật khẩu đó khi khôi phục. Website không lưu mật khẩu này.'}
        </p>
      </div>
      <div className='grid gap-6 lg:grid-cols-2'>
        <div className='space-y-3'>
          <div>
            <h3 className='text-base font-semibold text-primary'>
              {en ? 'Create backup' : 'Tạo bản sao lưu'}
            </h3>
            <p className='mt-1 text-sm text-secondary'>
              {en
                ? 'Pause source edits while exporting for a consistent snapshot. External source credentials are configured on the server and used read-only.'
                : 'Tạm ngừng cập nhật nguồn khi sao lưu. Nguồn bên ngoài được cấu hình tại server và chỉ được truy cập để đọc.'}
            </p>
          </div>
          <label className='block text-sm text-secondary'>
            {en ? 'Source' : 'Nguồn dữ liệu'}
            <select
              value={source}
              disabled={!!busy || !enabled}
              onChange={(e) => setSource(e.target.value)}
              className={`${field} mt-1`}>
              <option value='current'>
                {en ? 'Current project' : 'Project hiện tại'}
              </option>
              <option
                value='external'
                disabled={!status?.externalSourceConfigured}>
                {en
                  ? 'Configured external source (read only)'
                  : 'Project nguồn bên ngoài đã cấu hình (chỉ đọc)'}
              </option>
            </select>
          </label>
          <button
            type='button'
            disabled={!enabled || !!busy || password.length < 12}
            onClick={() => void perform('export')}
            className={button}>
            <Download className='size-4' />
            {busy === 'export'
              ? en
                ? 'Creating backup…'
                : 'Đang tạo bản sao lưu…'
              : en
                ? 'Download full backup'
                : 'Tải bản sao lưu đầy đủ'}
          </button>
        </div>
        <div className='space-y-3'>
          <div>
            <h3 className='text-base font-semibold text-primary'>
              {en ? 'Restore from file' : 'Khôi phục từ file'}
            </h3>
            <p className='mt-1 text-sm text-secondary'>
              {en
                ? 'Replaces website data and imports source passwords. The destination recovery admin is retained; other destination-only accounts lose website access. Old source approval links are invalidated; collection links are disabled for cross-project restores.'
                : 'Thay thế dữ liệu website và nhập mật khẩu nguồn. Giữ admin đang thao tác để khôi phục quyền truy cập; tài khoản chỉ có ở nơi nhận bị ngừng quyền vào website. Vô hiệu link duyệt tài khoản cũ; tắt link thu thập khi chuyển project.'}
            </p>
          </div>
          <label
            htmlFor='website-backup-file'
            className='block text-sm text-secondary'>
            {en ? 'Encrypted .ftbackup file' : 'File .ftbackup đã mã hóa'}
          </label>
          <input
            id='website-backup-file'
            type='file'
            accept='.ftbackup'
            disabled={!!busy || !enabled}
            onChange={(e) => {
              setFile(e.target.files?.[0] || null)
              resetPreview()
            }}
            className={field}
          />
          <button
            type='button'
            disabled={!enabled || !!busy || password.length < 12 || !file}
            onClick={() => void perform('inspect')}
            className={button}>
            <Upload className='size-4' />
            {busy === 'inspect'
              ? en
                ? 'Checking…'
                : 'Đang kiểm tra…'
              : en
                ? 'Inspect file'
                : 'Kiểm tra file'}
          </button>
        </div>
      </div>
      {preview && (
        <div className='space-y-4 rounded-xl border border-border bg-neutral p-4 text-sm'>
          <div>
            <h3 className='text-base font-semibold text-primary'>
              {en ? 'Restore preview' : 'Xem trước khôi phục'}
            </h3>
            <p className='mt-1 text-secondary'>
              <code>{preview.sourceProjectRef}</code> →{' '}
              <code>{preview.targetProjectRef}</code>
            </p>
            <p className='mt-1 text-secondary'>
              {new Date(preview.createdAt).toLocaleString(en ? 'en' : 'vi-VN')}{' '}
              · {preview.fileCount} {en ? 'image files' : 'file ảnh'} ·{' '}
              {(preview.fileBytes / 1024 / 1024).toFixed(1)} MiB
            </p>
          </div>
          <div className='overflow-x-auto'>
            <table className='w-full text-left text-sm'>
              <caption className='sr-only'>
                {en ? 'Records to restore' : 'Số bản ghi sẽ khôi phục'}
              </caption>
              <thead>
                <tr>
                  <th className='py-2 font-medium'>
                    {en ? 'Data table' : 'Bảng dữ liệu'}
                  </th>
                  <th className='py-2 text-right font-medium'>
                    {en ? 'Records' : 'Bản ghi'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(preview.counts).map(([name, count]) => (
                  <tr key={name} className='border-t border-border'>
                    <td className='py-1.5'>{name}</td>
                    <td className='py-1.5 text-right'>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.adminMapping && (
            <div className='space-y-3 rounded-xl border border-border bg-surface p-4 text-primary'>
              <p className='font-medium'>
                {en
                  ? 'Admin account mapping requires your consent'
                  : 'Cần đồng ý ánh xạ tài khoản admin'}
              </p>
              <p className='break-all'>
                {preview.adminMapping.email}
                <br />
                {en ? 'Source ID' : 'ID nguồn'}:{' '}
                <code>{preview.adminMapping.sourceId}</code>
                <br />
                {en ? 'Destination ID' : 'ID đích'}:{' '}
                <code>{preview.adminMapping.targetId}</code>
              </p>
              <p className='text-secondary'>
                {en
                  ? 'Articles, images, review history and the linked family member will belong to the destination admin. Content is preserved. The destination password and login methods are retained; the source admin password and login methods are not imported.'
                  : 'Bài viết, ảnh, lịch sử duyệt và liên kết hồ sơ gia phả được chuyển sang admin đích; nội dung được giữ nguyên. Giữ mật khẩu và phương thức đăng nhập đích; không nhập mật khẩu hoặc phương thức đăng nhập của admin nguồn.'}
              </p>
              <label className='flex items-start gap-2 text-sm'>
                <input
                  type='checkbox'
                  checked={acceptAdminMapping}
                  disabled={!!busy}
                  onChange={(e) => setAcceptAdminMapping(e.target.checked)}
                  className='mt-1 accent-tertiary'
                />
                <span>
                  {en
                    ? 'I confirm these accounts belong to the same person and agree to map the source admin to the destination admin.'
                    : 'Tôi xác nhận hai tài khoản là cùng một người và đồng ý ánh xạ admin nguồn sang admin đích.'}
                </span>
              </label>
            </div>
          )}
          <p className='text-secondary'>
            {en
              ? 'Back up the destination before proceeding. Files are verified before the database switch. Keep this window open until the result is shown.'
              : 'Sao lưu nơi nhận trước khi tiếp tục. File ảnh được kiểm tra trước khi chuyển dữ liệu database. Giữ cửa sổ này mở đến khi có kết quả.'}
          </p>
          <label
            htmlFor='website-backup-confirmation'
            className='block text-sm font-medium text-primary'>
            {en ? 'Type exactly' : 'Nhập chính xác'}:{' '}
            <code>{preview.confirmation}</code>
          </label>
          <input
            id='website-backup-confirmation'
            value={confirmation}
            disabled={!!busy}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete='off'
            className={field}
          />
          <button
            type='button'
            disabled={
              !!busy ||
              confirmation !== preview.confirmation ||
              (!!preview.adminMapping && !acceptAdminMapping)
            }
            onClick={() => void perform('restore')}
            className={button}>
            {busy === 'restore'
              ? en
                ? 'Restoring…'
                : 'Đang khôi phục…'
              : en
                ? 'Restore to this project'
                : 'Khôi phục vào project này'}
          </button>
        </div>
      )}
      {message && (
        <p
          role={error ? 'alert' : 'status'}
          className={`rounded-xl bg-neutral p-4 text-sm ${error ? 'text-error' : 'text-primary'}`}>
          {message}
        </p>
      )}
      {busy && (
        <p role='status' className='text-sm text-secondary'>
          {en
            ? 'Processing. Keep this window open; larger image sets take longer.'
            : 'Đang xử lý. Giữ cửa sổ mở; bộ ảnh lớn cần nhiều thời gian hơn.'}
        </p>
      )}
    </section>
  )
}
