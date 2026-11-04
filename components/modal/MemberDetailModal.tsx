'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ArrowLeft, Edit2, ExternalLink, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import MemberForm from '@/components/MemberForm'
import { useUser } from '@/components/UserProvider'
import MemberDetailContent from '@/context/MemberDetailContent'
import { useMemberListView } from '@/context/MemberListContext'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { Person } from '@/types'

export default function MemberDetailModal() {
  const { t } = useI18n()
  const {
    memberModalId: memberId,
    setMemberModalId,
    showCreateMember,
    setShowCreateMember
  } = useMemberListView()
  const { isAdmin, isEditor, supabase } = useUser()
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [person, setPerson] = useState<Person | null>(null)
  const [canEditPerson, setCanEditPerson] = useState(false)
  const canEdit = isEditor && canEditPerson && person?.id === memberId
  const [privateData, setPrivateData] = useState<Record<
    string,
    unknown
  > | null>(null)
  const isOpen = Boolean(memberId || showCreateMember)

  const closeModal = useCallback(() => {
    setMemberModalId(null)
    setShowCreateMember(false)
    setIsEditing(false)
  }, [setMemberModalId, setShowCreateMember])

  // Escape closes the detail view (not the form, to avoid losing edits)
  useEffect(() => {
    if (!isOpen || isEditing || showCreateMember) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, isEditing, showCreateMember, closeModal])

  const fetchData = useCallback(
    async (id: string) => {
      setLoading(true)
      setError(null)
      setCanEditPerson(false)
      try {
        // Public and (admin-only) private data are fetched in parallel
        const [personRes, privateRes] = await Promise.all([
          supabase.from('persons').select('*').eq('id', id).single(),
          isAdmin
            ? supabase
                .from('person_details_private')
                .select('*')
                .eq('person_id', id)
                .maybeSingle()
            : Promise.resolve(null)
        ])

        if (personRes.error || !personRes.data) {
          throw new Error(t('memberLoadError'))
        }
        let editable = isEditor
        if (editable && personRes.data.family_branch_id) {
          const permission = await supabase.rpc('can_edit_person', {
            p_person_id: id
          })
          editable = !permission.error && permission.data === true
        }
        setCanEditPerson(editable)
        setPerson(personRes.data)
        setPrivateData(isAdmin ? privateRes?.data || {} : null)
      } catch (err) {
        console.error('Error fetching member details:', err)
        // @ts-expect-error - err is caught as unknown, but we check for message
        setError(err?.message || t('systemError'))
      } finally {
        setLoading(false)
      }
    },
    [isAdmin, isEditor, supabase, t]
  )

  // Sync state with URL parameter or create mode
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null

    if (memberId) {
      timeoutId = setTimeout(() => {
        setIsEditing(false) // always start on detail view when opening
        fetchData(memberId)
      }, 0)
    } else if (showCreateMember) {
      timeoutId = setTimeout(() => {
        setIsEditing(false)
        setPerson(null)
        setPrivateData(null)
        setError(null)
      }, 0)
    } else {
      timeoutId = setTimeout(() => {
        setPerson(null)
        setPrivateData(null)
        setError(null)
        setIsEditing(false)
      }, 300)
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [memberId, showCreateMember, fetchData])

  // Prevent background scrolling when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  // Called by MemberForm after a successful save
  const handleEditSuccess = (savedPersonId: string) => {
    // Clear stale data first so the loading state is shown while refetching
    setIsEditing(false)
    setPerson(null)
    setPrivateData(null)
    fetchData(savedPersonId)
    // Revalidate Next.js server component cache so the dashboard list/members updates
    router.refresh()
  }

  // Called by MemberForm after a successful CREATE
  const handleCreateSuccess = (savedPersonId: string) => {
    setShowCreateMember(false)
    // Open the detail modal for the new member
    setMemberModalId(savedPersonId)
    // Delay refresh so React commits state changes first,
    // ensuring the server component re-fetches the updated member list.
    setTimeout(() => {
      router.refresh()
    }, 100)
  }

  // initialData for MemberForm — merge public + private
  const formInitialData = person
    ? { ...person, ...(privateData ?? {}) }
    : undefined

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          role='dialog'
          aria-modal='true'
          className='fixed inset-0 z-100 flex items-center justify-center bg-stone-900/40 sm:p-6'>
          {/* Click-away backdrop (disabled while editing/creating to avoid accidental close) */}
          {!isEditing && !showCreateMember && (
            <div
              className='absolute inset-0 cursor-pointer'
              onClick={closeModal}
            />
          )}

          {/* Modal Content */}
          <motion.div
            layout
            initial={{ scale: 0.96, opacity: 0, y: 15 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 15 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            layoutDependency={false}
            className='relative flex h-full w-full max-w-4xl flex-col overflow-hidden bg-surface sm:h-auto sm:max-h-[90vh] sm:rounded-3xl sm:border sm:border-stone-200'>
            {/* Sticky Header Actions */}
            <div className='absolute top-4 right-4 z-20 flex items-center gap-2 sm:top-5 sm:right-5'>
              {isEditing ? (
                /* In edit mode — show back button */
                <button
                  onClick={() => {
                    setIsEditing(false)
                  }}
                  className='inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-stone-200/50 bg-stone-100/80 px-3 py-2.5 text-sm font-medium text-stone-700 transition-all duration-300 hover:-translate-y-1 hover:bg-stone-200'>
                  <ArrowLeft className='size-4' />
                  <span className='hidden sm:inline'>
                    {t('backToPrevious')}
                  </span>
                </button>
              ) : (
                canEdit &&
                person && (
                  <>
                    <Link
                      href={`/dashboard/members/${person.id}`}
                      className='btn-amber text-sm'>
                      <ExternalLink className='size-4' />
                      <span className='hidden sm:inline'>{t('view')}</span>
                    </Link>
                    <button
                      onClick={() => setIsEditing(true)}
                      className='btn-amber text-sm'>
                      <Edit2 className='size-4' />
                      <span className='hidden sm:inline'>
                        {t('editMember')}
                      </span>
                    </button>
                  </>
                )
              )}
              <button
                onClick={closeModal}
                className='flex size-10 items-center justify-center rounded-full border border-stone-200/50 bg-stone-100/80 text-stone-600 transition-colors hover:bg-stone-200 hover:text-stone-900'
                aria-label={t('close')}>
                <X className='size-5' />
              </button>
            </div>

            <AnimatePresence mode='wait'>
              {loading ? (
                <motion.div
                  key='loading'
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className='flex min-h-125 flex-1 flex-col items-center justify-center gap-4'>
                  <div className='size-10 animate-spin rounded-full border-4 border-amber-600 border-t-transparent'></div>
                  <p className='font-medium text-stone-500'>
                    {t('loadingMember')}
                  </p>
                </motion.div>
              ) : error ? (
                <motion.div
                  key='error'
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className='flex min-h-100 flex-1 flex-col items-center justify-center gap-4 p-8 text-center'>
                  <div className='mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-500 shadow-inner'>
                    <AlertCircle className='size-8' />
                  </div>
                  <p className='text-sm font-medium text-red-600'>{error}</p>
                  <button
                    onClick={closeModal}
                    className='btn mt-2 rounded-full'>
                    {t('close')}
                  </button>
                </motion.div>
              ) : isEditing && canEdit && formInitialData ? (
                /* ── EDIT MODE ── */
                <motion.div
                  key='editing'
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.2 }}
                  className='custom-scrollbar flex-1 overflow-y-auto px-4 pt-16 pb-8 sm:px-8'>
                  <h2 className='mb-6 font-serif text-xl font-semibold text-stone-800'>
                    {t('editMember')}
                  </h2>
                  <MemberForm
                    initialData={
                      formInitialData as Parameters<
                        typeof MemberForm
                      >[0]['initialData']
                    }
                    isEditing={true}
                    isAdmin={isAdmin}
                    onSuccess={handleEditSuccess}
                    onCancel={() => setIsEditing(false)}
                  />
                </motion.div>
              ) : showCreateMember ? (
                /* ── CREATE MODE ── */
                <motion.div
                  key='creating'
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.2 }}
                  className='custom-scrollbar flex-1 overflow-y-auto px-4 pt-16 pb-8 sm:px-8'>
                  <h2 className='mb-6 font-serif text-xl font-semibold text-stone-800'>
                    {t('newMember')}
                  </h2>
                  <MemberForm
                    isAdmin={isAdmin}
                    onSuccess={handleCreateSuccess}
                    onCancel={closeModal}
                  />
                </motion.div>
              ) : person ? (
                /* ── DETAIL MODE ── */
                <motion.div
                  key='details'
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                  className='custom-scrollbar flex-1 overflow-y-auto'>
                  <MemberDetailContent
                    person={person}
                    privateData={privateData}
                    isAdmin={isAdmin}
                    canEdit={canEdit}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
