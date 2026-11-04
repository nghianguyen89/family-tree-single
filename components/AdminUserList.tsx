'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Trash } from 'lucide-react'
import { useState } from 'react'

import {
  adminCreateUser,
  changeUserRole,
  deleteUser,
  toggleUserStatus
} from '@/app/actions/user'
import UserPersonLink, {
  type UserPersonOption
} from '@/components/admin/UserPersonLink'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { AdminUserData, UserRole } from '@/types'

interface AdminUserListProps {
  initialUsers: AdminUserData[]
  currentUserId: string
  persons: UserPersonOption[]
  personLinkUnavailable: boolean
}

interface Notification {
  message: string
  type: 'success' | 'error' | 'info'
}

export default function AdminUserList({
  initialUsers,
  currentUserId,
  persons,
  personLinkUnavailable
}: AdminUserListProps) {
  const { t, locale } = useI18n()
  const [users, setUsers] = useState<AdminUserData[]>(initialUsers)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [notification, setNotification] = useState<Notification | null>(null)

  const showNotification = (
    message: string,
    type: 'success' | 'error' | 'info' = 'info'
  ) => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 5000)
  }

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    try {
      setLoadingId(userId)
      const result = await changeUserRole(userId, newRole)

      if (result?.error) {
        showNotification(result.error, 'error')
        return
      }

      setUsers(
        users.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      )
      showNotification(t('adminRoleUpdated'), 'success')
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : t('adminUnknownRoleError')
      showNotification(msg, 'error')
    } finally {
      setLoadingId(null)
    }
  }

  const handleStatusChange = async (userId: string, newStatus: boolean) => {
    try {
      setLoadingId(userId)
      const result = await toggleUserStatus(userId, newStatus)

      if (result?.error) {
        showNotification(result.error, 'error')
        return
      }

      setUsers(
        users.map((u) => (u.id === userId ? { ...u, is_active: newStatus } : u))
      )
      showNotification(
        t(newStatus ? 'adminStatusUpdated' : 'adminStatusLocked'),
        'success'
      )
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : t('adminUnknownStatusError')
      showNotification(msg, 'error')
    } finally {
      setLoadingId(null)
    }
  }

  const handleDelete = async (userId: string) => {
    if (!confirm(t('adminConfirmDelete'))) return
    try {
      setLoadingId(userId)
      const result = await deleteUser(userId)

      if (result?.error) {
        showNotification(result.error, 'error')
        return
      }

      setUsers(users.filter((u) => u.id !== userId))
      showNotification(t('adminDeleted'), 'success')
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : t('adminUnknownDeleteError')
      showNotification(msg, 'error')
    } finally {
      setLoadingId(null)
    }
  }

  const handleCreateUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsCreating(true)
    const formData = new FormData(e.currentTarget)
    try {
      const result = await adminCreateUser(formData)

      if (result?.error) {
        showNotification(result.error, 'error')
        return
      }

      showNotification(t('adminCreated'), 'success')
      setIsCreateModalOpen(false)
      setTimeout(() => window.location.reload(), 1500)
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : t('adminUnknownCreateError')
      showNotification(msg, 'error')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className='relative space-y-6'>
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className={`fixed top-1/2 left-1/2 z-100 flex max-w-[90vw] min-w-[320px] items-center gap-3 rounded-xl border px-6 py-3 ${
              notification.type === 'success'
                ? 'border-emerald-200 bg-emerald-50/90 text-emerald-800'
                : notification.type === 'error'
                  ? 'border-red-200 bg-red-50/90 text-red-800'
                  : 'border-amber-200 bg-amber-50/90 text-amber-800'
            }`}>
            {notification.type === 'success' && (
              <svg
                className='size-5 shrink-0'
                fill='none'
                viewBox='0 0 24 24'
                stroke='currentColor'>
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M5 13l4 4L19 7'
                />
              </svg>
            )}
            {notification.type === 'error' && (
              <svg
                className='size-5 shrink-0'
                fill='none'
                viewBox='0 0 24 24'
                stroke='currentColor'>
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M6 18L18 6M6 6l12 12'
                />
              </svg>
            )}
            {notification.type === 'info' && (
              <svg
                className='size-5 shrink-0'
                fill='none'
                viewBox='0 0 24 24'
                stroke='currentColor'>
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                />
              </svg>
            )}
            <p className='text-sm font-medium'>{notification.message}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <p className='text-sm text-secondary'>
        {locale === 'vi'
          ? 'Admin xác nhận mỗi tài khoản đại diện cho ai trên cây họ chính. Không tự ghép theo email hoặc tên. Mỗi người chỉ liên kết với một tài khoản.'
          : 'An admin confirms who each account represents in the main family tree. Accounts are never matched by email or name. Each person can be linked to one account.'}
      </p>
      {personLinkUnavailable && (
        <p role='alert' className='text-sm text-error'>
          {locale === 'vi'
            ? 'Không tải được liên kết tài khoản hoặc danh sách người. Kiểm tra kết nối, quyền và migration liên kết tài khoản trước khi thử lại.'
            : 'Account links or people could not be loaded. Check the connection, permissions and account-link migration before retrying.'}
        </p>
      )}

      <div className='flex justify-end'>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className='btn-primary'>
          <svg
            className='size-4'
            fill='none'
            viewBox='0 0 24 24'
            stroke='currentColor'>
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M12 4v16m8-8H4'
            />
          </svg>
          {t('adminAddUser')}
        </button>
      </div>

      <div className='overflow-hidden rounded-2xl border border-stone-200/60 bg-surface'>
        <div className='custom-scrollbar overflow-x-auto'>
          <table className='w-full text-left text-sm whitespace-nowrap'>
            <thead className='border-b border-stone-200/60 bg-stone-50/50'>
              <tr>
                <th className='px-6 py-4 text-sm font-medium text-stone-500'>
                  {t('adminEmail')}
                </th>
                <th className='px-6 py-4 text-sm font-medium text-stone-500'>
                  {locale === 'vi' ? 'Người trên cây' : 'Tree person'}
                </th>
                <th className='px-6 py-4 text-sm font-medium text-stone-500'>
                  {t('adminRole')}
                </th>
                <th className='px-6 py-4 text-sm font-medium text-stone-500'>
                  {t('adminStatus')}
                </th>
                <th className='px-6 py-4 text-sm font-medium text-stone-500'>
                  {t('adminCreatedAt')}
                </th>
                <th className='px-6 py-4 text-right text-sm font-medium text-stone-500'>
                  {t('adminActions')}
                </th>
              </tr>
            </thead>
            <tbody className='divide-y divide-stone-100'>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className='transition-colors hover:bg-stone-50/80'>
                  <td className='px-6 py-4 font-medium text-stone-900'>
                    {user.email}
                  </td>
                  <td className='px-6 py-4'>
                    <UserPersonLink
                      user={user}
                      persons={persons}
                      disabled={
                        personLinkUnavailable || user.person_id === undefined
                      }
                      onSaved={(personId) =>
                        setUsers((current) =>
                          current.map((item) =>
                            item.id === user.id
                              ? { ...item, person_id: personId }
                              : item
                          )
                        )
                      }
                    />
                  </td>
                  <td className='px-6 py-4'>
                    {user.id === currentUserId ? (
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-1 text-sm font-medium ${
                          user.role === 'admin'
                            ? 'border border-amber-200 bg-amber-100 text-amber-800'
                            : user.role === 'editor'
                              ? 'border border-sky-200 bg-sky-100 text-sky-800'
                              : 'border border-stone-200 bg-stone-100 text-stone-600'
                        }`}>
                        {user.role === 'admin'
                          ? t('adminAdminRole')
                          : user.role === 'editor'
                            ? t('adminEditorRole')
                            : t('adminMemberRole')}
                      </span>
                    ) : (
                      <select
                        value={user.role}
                        onChange={(e) =>
                          handleRoleChange(user.id, e.target.value as UserRole)
                        }
                        disabled={loadingId === user.id}
                        className='rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-sm text-stone-700 transition-colors outline-none hover:border-stone-300 focus:border-amber-500 focus:ring-amber-500 disabled:opacity-50'>
                        <option value='admin'>{t('adminAdminRole')}</option>
                        <option value='editor'>{t('adminEditorRole')}</option>
                        <option value='member'>{t('adminMemberRole')}</option>
                      </select>
                    )}
                  </td>
                  <td className='px-6 py-4'>
                    <button
                      disabled={
                        loadingId === user.id || user.id === currentUserId
                      }
                      onClick={() =>
                        handleStatusChange(user.id, !user.is_active)
                      }
                      className={`inline-flex items-center rounded-md px-2 py-1 text-sm font-medium transition-colors ${
                        user.is_active
                          ? 'border border-emerald-200 bg-emerald-100 text-emerald-800'
                          : 'border border-stone-200 bg-stone-100 text-stone-800'
                      } ${
                        user.id !== currentUserId
                          ? 'cursor-pointer hover:opacity-80'
                          : 'cursor-not-allowed opacity-50'
                      } disabled:opacity-50`}
                      title={
                        user.id !== currentUserId
                          ? user.is_active
                            ? t('adminClickToLock')
                            : t('adminClickToApprove')
                          : t('adminSelfStatusDisabled')
                      }>
                      {user.is_active ? t('adminApproved') : t('adminPending')}
                    </button>
                  </td>
                  <td className='px-6 py-4 text-stone-500'>
                    {new Date(user.created_at).toLocaleDateString('vi-VN')}
                  </td>
                  <td className='px-6 py-4 text-right'>
                    {user.id !== currentUserId && (
                      <div className='flex items-center justify-end gap-2'>
                        <button
                          title={t('adminDeleteUser')}
                          disabled={loadingId === user.id}
                          onClick={() => handleDelete(user.id)}
                          className='rounded-md p-1.5 text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50'>
                          <Trash className='size-4' />
                        </button>
                      </div>
                    )}
                    {user.id === currentUserId && (
                      <span className='text-sm text-stone-400 italic'>
                        {t('adminYou')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className='px-6 py-8 text-center text-stone-500'>
                    {t('adminNoUsers')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      {isCreateModalOpen && (
        <div className='fixed inset-0 z-60 flex items-center justify-center bg-stone-900/40 p-4 transition-opacity duration-300'>
          <div className='w-full max-w-md transform overflow-hidden rounded-2xl border border-stone-200/60 bg-surface transition-all'>
            <div className='flex items-center justify-between border-b border-stone-100/80 bg-stone-50/50 px-6 py-5'>
              <h3 className='font-serif text-xl font-semibold text-stone-800'>
                {t('adminCreateTitle')}
              </h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className='flex size-8 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600'>
                <svg
                  className='size-5'
                  fill='none'
                  viewBox='0 0 24 24'
                  stroke='currentColor'>
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M6 18L18 6M6 6l12 12'
                  />
                </svg>
              </button>
            </div>

            <form onSubmit={handleCreateUser} className='p-6'>
              <div className='space-y-4'>
                <div>
                  <label className='mb-1 block text-sm font-medium text-stone-700'>
                    {t('adminEmail')} <span className='text-red-500'>*</span>
                  </label>
                  <input
                    type='email'
                    name='email'
                    required
                    className='w-full rounded-lg border border-stone-300 bg-surface px-3 py-2 text-stone-900 placeholder-stone-400 transition-colors focus:border-amber-500 focus:ring-1 focus:ring-amber-500 focus:outline-none sm:py-2.5'
                    placeholder='email@example.com'
                  />
                </div>

                <div>
                  <label className='mb-1 block text-sm font-medium text-stone-700'>
                    {t('password')} <span className='text-red-500'>*</span>
                  </label>
                  <input
                    type='password'
                    name='password'
                    required
                    minLength={6}
                    className='w-full rounded-lg border border-stone-300 bg-surface px-3 py-2 text-stone-900 placeholder-stone-400 transition-colors focus:border-amber-500 focus:ring-1 focus:ring-amber-500 focus:outline-none sm:py-2.5'
                    placeholder={t('adminPasswordMinLength')}
                  />
                </div>

                <div>
                  <label className='mb-1 block text-sm font-medium text-stone-700'>
                    {t('adminRole')}
                  </label>
                  <select
                    name='role'
                    className='w-full rounded-lg border border-stone-300 bg-surface px-3 py-2 text-stone-900 placeholder-stone-400 transition-colors focus:border-amber-500 focus:ring-1 focus:ring-amber-500 focus:outline-none sm:py-2.5'
                    defaultValue='member'>
                    <option value='member'>{t('adminMemberRole')}</option>
                    <option value='editor'>{t('adminEditorRole')}</option>
                    <option value='admin'>{t('adminAdminRole')}</option>
                  </select>
                </div>

                <div>
                  <label className='mb-1 block text-sm font-medium text-stone-700'>
                    {t('adminStatus')}
                  </label>
                  <select
                    name='is_active'
                    className='w-full rounded-lg border border-stone-300 bg-surface px-3 py-2 text-stone-900 placeholder-stone-400 transition-colors focus:border-amber-500 focus:ring-1 focus:ring-amber-500 focus:outline-none sm:py-2.5'
                    defaultValue='true'>
                    <option value='true'>{t('adminApproved')}</option>
                    <option value='false'>{t('adminPending')}</option>
                  </select>
                </div>
              </div>

              <div className='mt-8 flex justify-end gap-3 pt-2'>
                <button
                  type='button'
                  onClick={() => setIsCreateModalOpen(false)}
                  className='btn'>
                  {t('adminCancel')}
                </button>
                <button
                  type='submit'
                  disabled={isCreating}
                  className='btn-primary'>
                  {isCreating ? t('adminCreating') : t('adminCreateUser')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
