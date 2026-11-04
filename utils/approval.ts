import { createHash, randomBytes } from 'node:crypto'

export const APPROVAL_TOKEN_TTL_DAYS = 7

export function createApprovalToken() {
  return randomBytes(32).toString('base64url')
}

export function hashApprovalToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function getApprovalTokenExpiry() {
  const expiry = new Date()
  expiry.setDate(expiry.getDate() + APPROVAL_TOKEN_TTL_DAYS)
  return expiry.toISOString()
}
