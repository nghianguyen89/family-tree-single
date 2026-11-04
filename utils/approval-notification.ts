import {
  createApprovalToken,
  getApprovalTokenExpiry,
  hashApprovalToken
} from '@/utils/approval'
import { getDeploymentConfig } from '@/utils/deployment'
import { getAdminSupabase } from '@/utils/supabase/admin'

import 'server-only'

interface PendingUser {
  id: string
  email: string
}

interface NotificationResult {
  sent: boolean
  configured: boolean
  reason?: string
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      })[character] || character
  )
}

function getConfiguredAdminEmails() {
  return (process.env.ADMIN_NOTIFICATION_EMAIL || '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
}

async function getAdminEmails(supabase: ReturnType<typeof getAdminSupabase>) {
  const configuredEmails = getConfiguredAdminEmails()
  if (configuredEmails.length > 0) return configuredEmails

  const { data: admins, error: adminsError } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
    .eq('is_active', true)

  if (adminsError) {
    console.error('Cannot find active administrators:', adminsError)
    return []
  }

  const adminUsers = await Promise.all(
    (admins || []).map(({ id }) => supabase.auth.admin.getUserById(id))
  )

  return adminUsers
    .map(({ data }) => data.user?.email)
    .filter((email): email is string => Boolean(email))
}

export async function notifyAdminOfPendingUser({
  id,
  email
}: PendingUser): Promise<NotificationResult> {
  try {
    return await sendPendingUserNotification({ id, email })
  } catch (error) {
    console.error('Cannot notify administrators of pending user:', error)
    return { sent: false, configured: true, reason: 'notification_failed' }
  }
}

async function sendPendingUserNotification({
  id,
  email
}: PendingUser): Promise<NotificationResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  let appUrl: string
  try {
    appUrl = getDeploymentConfig().appUrl
  } catch {
    return {
      sent: false,
      configured: false,
      reason: 'invalid_deployment_configuration'
    }
  }

  if (!apiKey || !from || !appUrl) {
    console.warn(
      'Pending-user email is not configured. Set RESEND_API_KEY, RESEND_FROM_EMAIL, and APP_URL.'
    )
    return { sent: false, configured: false, reason: 'missing_configuration' }
  }

  let supabase
  try {
    supabase = getAdminSupabase()
  } catch (error) {
    console.error('Cannot create the Supabase admin client:', error)
    return { sent: false, configured: false, reason: 'missing_service_key' }
  }

  const adminEmails = await getAdminEmails(supabase)
  if (adminEmails.length === 0) {
    console.warn(
      'No active administrator email was found. Set ADMIN_NOTIFICATION_EMAIL or ensure the admin account has an email.'
    )
    return { sent: false, configured: false, reason: 'missing_admin_email' }
  }

  const { data: existingRequest, error: lookupError } = await supabase
    .from('user_approval_requests')
    .select('id, token_hash, used_at, expires_at, notified_at, created_at')
    .eq('user_id', id)
    .maybeSingle()

  if (lookupError) {
    console.error(
      'Cannot look up the pending-user approval request:',
      lookupError
    )
    return { sent: false, configured: true, reason: 'database_lookup_failed' }
  }

  if (
    existingRequest &&
    !existingRequest.used_at &&
    new Date(existingRequest.expires_at).getTime() > Date.now()
  ) {
    if (existingRequest.notified_at) {
      return { sent: false, configured: true, reason: 'already_notified' }
    }
    // A short lease prevents concurrent callbacks from sending different links.
    if (new Date(existingRequest.created_at).getTime() > Date.now() - 120_000) {
      return {
        sent: false,
        configured: true,
        reason: 'notification_in_progress'
      }
    }
  }

  const token = createApprovalToken()
  const tokenHash = hashApprovalToken(token)
  const values = {
    user_id: id,
    email,
    token_hash: tokenHash,
    expires_at: getApprovalTokenExpiry(),
    used_at: null,
    notified_at: null,
    created_at: new Date().toISOString()
  }
  const table = supabase.from('user_approval_requests')
  let claim
  if (existingRequest) {
    claim = table
      .update(values)
      .eq('id', existingRequest.id)
      .eq('token_hash', existingRequest.token_hash)
    claim = existingRequest.notified_at
      ? claim.eq('notified_at', existingRequest.notified_at)
      : claim.is('notified_at', null)
    claim = existingRequest.used_at
      ? claim.eq('used_at', existingRequest.used_at)
      : claim.is('used_at', null)
  } else {
    claim = table.upsert(values, {
      onConflict: 'user_id',
      ignoreDuplicates: true
    })
  }
  const { data: approvalRequest, error: insertError } = await claim
    .select('id')
    .maybeSingle()

  if (insertError) {
    console.error(
      'Cannot create the pending-user approval request:',
      insertError
    )
    return { sent: false, configured: true, reason: 'database_insert_failed' }
  }
  if (!approvalRequest) {
    return { sent: false, configured: true, reason: 'notification_in_progress' }
  }

  const approveUrl = `${appUrl}/api/admin/approve/${token}`
  const safeEmail = escapeHtml(email)
  const subject = `Có tài khoản mới đang chờ duyệt: ${email}`
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#292524;max-width:640px">
      <h2 style="color:#b45309">Tài khoản mới chờ duyệt</h2>
      <p>Có người dùng vừa xác nhận email và đang chờ được duyệt để truy cập dữ liệu gia phả:</p>
      <p><strong>${safeEmail}</strong></p>
      <p>
        <a href="${escapeHtml(approveUrl)}" style="display:inline-block;background:#d97706;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">
          Xem và duyệt tài khoản
        </a>
      </p>
      <p style="color:#78716c;font-size:13px">Liên kết có hiệu lực trong ${7} ngày. Bạn cũng có thể đăng nhập ứng dụng và duyệt trong mục Quản lý người dùng.</p>
    </div>
  `
  const text = `Tài khoản ${email} đang chờ duyệt. Duyệt tại: ${approveUrl}\n\nBạn cũng có thể đăng nhập ứng dụng và duyệt trong mục Quản lý người dùng.`

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        from,
        to: adminEmails,
        subject,
        html,
        text
      })
    })

    if (!response.ok)
      throw new Error(`Email provider returned ${response.status}`)
  } catch (error) {
    console.error('Cannot send pending-user email:', error)
    try {
      const { error: cleanupError } = await supabase
        .from('user_approval_requests')
        .delete()
        .eq('id', approvalRequest.id)
        .eq('token_hash', tokenHash)
        .is('notified_at', null)
        .is('used_at', null)
      if (cleanupError)
        console.error('Cannot clear failed notification:', cleanupError)
    } catch (cleanupError) {
      console.error('Cannot clear failed notification:', cleanupError)
    }
    return { sent: false, configured: true, reason: 'email_send_failed' }
  }

  const { error: markNotifiedError } = await supabase
    .from('user_approval_requests')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', approvalRequest.id)
    .eq('token_hash', tokenHash)

  if (markNotifiedError) {
    console.error(
      'Pending-user email sent but could not be marked as notified:',
      markNotifiedError
    )
  }

  return { sent: true, configured: true }
}
