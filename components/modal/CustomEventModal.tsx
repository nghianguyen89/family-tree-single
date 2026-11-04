'use client'

import { AnimatePresence, motion, Variants } from 'framer-motion'
import {
  AlertCircle,
  AlignLeft,
  Calendar as CalendarIcon,
  Loader2,
  MapPin,
  Moon,
  Sun,
  X
} from 'lucide-react'
import { Lunar } from 'lunar-javascript'
import { useEffect, useState } from 'react'

import { useI18n } from '@/lib/i18n/I18nProvider'
import { CustomEventRecord } from '@/utils/eventHelpers'
import { createClient } from '@/utils/supabase/client'

interface CustomEventModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  eventToEdit?: CustomEventRecord | null
}

export default function CustomEventModal({
  isOpen,
  onClose,
  onSuccess,
  eventToEdit
}: CustomEventModalProps) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(eventToEdit?.name || '')
  const [eventDate, setEventDate] = useState(eventToEdit?.event_date || '')
  const [location, setLocation] = useState(eventToEdit?.location || '')
  const [content, setContent] = useState(eventToEdit?.content || '')

  // Lunar date mode
  const [dateMode, setDateMode] = useState<'solar' | 'lunar'>('solar')
  const [lunarDay, setLunarDay] = useState<number | ''>('')
  const [lunarMonth, setLunarMonth] = useState<number | ''>('')
  const [lunarYear, setLunarYear] = useState<number | ''>('')
  const [lunarConvertError, setLunarConvertError] = useState<string | null>(
    null
  )

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!isOpen) return
      if (eventToEdit) {
        setName(eventToEdit.name)
        setEventDate(eventToEdit.event_date)
        setLocation(eventToEdit.location || '')
        setContent(eventToEdit.content || '')
      } else {
        setName('')
        // Default to today
        const now = new Date()
        const y = now.getFullYear()
        const m = String(now.getMonth() + 1).padStart(2, '0')
        const d = String(now.getDate()).padStart(2, '0')
        setEventDate(`${y}-${m}-${d}`)
        setLocation('')
        setContent('')
      }
      setError(null)
      setDateMode('solar')
      setLunarDay('')
      setLunarMonth('')
      setLunarYear('')
      setLunarConvertError(null)
    })

    return () => cancelAnimationFrame(frame)
  }, [isOpen, eventToEdit])

  // Auto-convert lunar → solar when all 3 fields are filled
  useEffect(() => {
    if (
      dateMode === 'lunar' &&
      lunarDay !== '' &&
      lunarMonth !== '' &&
      lunarYear !== '' &&
      lunarYear > 100
    ) {
      const frame = requestAnimationFrame(() => {
        try {
          const lunar = Lunar.fromYmd(
            lunarYear as number,
            lunarMonth as number,
            lunarDay as number
          )
          const solar = lunar.getSolar()
          const y = solar.getYear()
          const m = String(solar.getMonth()).padStart(2, '0')
          const d = String(solar.getDay()).padStart(2, '0')
          setEventDate(`${y}-${m}-${d}`)
          setLunarConvertError(null)
        } catch {
          setLunarConvertError(t('lunarDateInvalid'))
        }
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [dateMode, lunarDay, lunarMonth, lunarYear, t])

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const payload = {
        name,
        event_date: eventDate,
        location: location || null,
        content: content || null
      }

      let resultError
      if (eventToEdit) {
        const { error: err } = await supabase
          .from('custom_events')
          .update(payload)
          .eq('id', eventToEdit.id)
        resultError = err
      } else {
        const { error: err } = await supabase
          .from('custom_events')
          .insert([payload])
        resultError = err
      }

      if (resultError) throw resultError

      onSuccess()
      onClose()
    } catch (err) {
      console.error(err)
      if (err instanceof Error) {
        setError(err.message || t('saveEventError'))
      } else {
        setError(t('saveEventError'))
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!eventToEdit) return
    if (!window.confirm(t('confirmDeleteEvent'))) return

    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: err } = await supabase
        .from('custom_events')
        .delete()
        .eq('id', eventToEdit.id)

      if (err) throw err

      onSuccess()
      onClose()
    } catch (err) {
      console.error(err)
      if (err instanceof Error) {
        setError(err.message || t('deleteEventError'))
      } else {
        setError(t('deleteEventError'))
      }
    } finally {
      setLoading(false)
    }
  }

  const formSectionVariants: Variants = {
    hidden: { opacity: 0, y: 10 },
    show: {
      opacity: 1,
      y: 0,
      transition: { type: 'spring', stiffness: 300, damping: 24 }
    }
  }

  const inputClasses =
    'bg-surface text-stone-900 placeholder-stone-500 block w-full rounded-xl border border-stone-300  focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:bg-surface text-sm px-4 py-3 transition-all outline-none!'

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className='fixed inset-0 z-100 flex items-center justify-center bg-stone-900/40 p-4 sm:p-6'>
          {/* Click-away backdrop */}
          <div className='absolute inset-0 cursor-pointer' onClick={onClose} />

          {/* Modal Content */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
            className='relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-stone-200 bg-surface'>
            {/* Sticky Header Actions */}
            <div className='absolute top-4 right-4 z-20 flex items-center gap-2 sm:top-5 sm:right-5'>
              <button
                type='button'
                onClick={onClose}
                className='flex size-10 items-center justify-center rounded-full border border-stone-200/50 bg-stone-100/80 text-stone-600 transition-colors hover:bg-stone-200 hover:text-stone-900'
                aria-label={t('close')}>
                <X className='size-5' />
              </button>
            </div>

            <div className='custom-scrollbar flex-1 overflow-y-auto px-4 pt-16 pb-8 sm:px-8'>
              <h2 className='mb-6 font-serif text-xl font-semibold text-stone-800'>
                {eventToEdit ? t('editEvent') : t('addCustomEvent')}
              </h2>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className='mb-6 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700'>
                    <AlertCircle className='mt-0.5 size-5 shrink-0' />
                    <p>{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <form onSubmit={handleSubmit} className='space-y-6'>
                <motion.div
                  variants={formSectionVariants}
                  initial='hidden'
                  animate='show'
                  className='space-y-5 rounded-2xl border border-stone-200/80 bg-surface/80 p-5 sm:p-6'>
                  <div>
                    <label className='mb-1.5 block text-sm font-medium text-stone-700'>
                      {t('eventName')} <span className='text-red-500'>*</span>
                    </label>
                    <input
                      required
                      type='text'
                      className={inputClasses}
                      placeholder={t('eventNamePlaceholder')}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>

                  <div>
                    <div className='mb-1.5 flex items-center justify-between'>
                      <label className='block text-sm font-medium text-stone-700'>
                        {t('eventDate')} <span className='text-red-500'>*</span>
                      </label>
                      <button
                        type='button'
                        onClick={() => {
                          setDateMode((m) =>
                            m === 'solar' ? 'lunar' : 'solar'
                          )
                          setLunarConvertError(null)
                        }}
                        className='flex items-center gap-1.5 rounded-lg border border-stone-200/60 bg-stone-50 px-2.5 py-1 text-sm font-medium text-stone-500 transition-colors hover:bg-amber-50 hover:text-amber-700'>
                        {dateMode === 'solar' ? (
                          <>
                            <Moon className='size-3' />
                            {t('enterLunar')}
                          </>
                        ) : (
                          <>
                            <Sun className='size-3' />
                            {t('enterSolar')}
                          </>
                        )}
                      </button>
                    </div>

                    {dateMode === 'solar' ? (
                      <div className='relative'>
                        <CalendarIcon className='absolute top-1/2 left-4 size-4 -translate-y-1/2 text-stone-400' />
                        <input
                          required
                          type='date'
                          className={`${inputClasses} pl-11`}
                          value={eventDate}
                          onChange={(e) => setEventDate(e.target.value)}
                        />
                      </div>
                    ) : (
                      <div className='space-y-3'>
                        <div className='grid grid-cols-3 gap-3'>
                          <input
                            type='number'
                            placeholder={t('day')}
                            min='1'
                            max='30'
                            value={lunarDay}
                            onChange={(e) =>
                              setLunarDay(
                                e.target.value ? Number(e.target.value) : ''
                              )
                            }
                            className={inputClasses}
                          />
                          <input
                            type='number'
                            placeholder={t('month')}
                            min='1'
                            max='12'
                            value={lunarMonth}
                            onChange={(e) =>
                              setLunarMonth(
                                e.target.value ? Number(e.target.value) : ''
                              )
                            }
                            className={inputClasses}
                          />
                          <input
                            type='number'
                            placeholder={t('year')}
                            value={lunarYear}
                            onChange={(e) =>
                              setLunarYear(
                                e.target.value ? Number(e.target.value) : ''
                              )
                            }
                            className={inputClasses}
                          />
                        </div>
                        {lunarConvertError && (
                          <p className='flex items-center gap-1 text-sm font-medium text-rose-500'>
                            <AlertCircle className='size-3' />
                            {lunarConvertError}
                          </p>
                        )}
                        {eventDate && !lunarConvertError && (
                          <p className='flex items-center gap-1.5 text-sm text-stone-500'>
                            <Sun className='size-3 text-amber-500' />
                            {t('solarDate')}:{' '}
                            <span className='font-medium text-stone-700'>
                              {eventDate.split('-').reverse().join('/')}
                            </span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className='mb-1.5 block text-sm font-medium text-stone-700'>
                      {t('location')}
                    </label>
                    <div className='relative'>
                      <MapPin className='absolute top-1/2 left-4 size-4 -translate-y-1/2 text-stone-400' />
                      <input
                        type='text'
                        className={`${inputClasses} pl-11`}
                        placeholder={t('locationPlaceholder')}
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className='mb-1.5 block text-sm font-medium text-stone-700'>
                      {t('details')}
                    </label>
                    <div className='relative'>
                      <AlignLeft className='absolute top-4 left-4 size-4 text-stone-400' />
                      <textarea
                        rows={3}
                        className={`${inputClasses} custom-scrollbar resize-none pl-11`}
                        placeholder={t('detailsPlaceholder')}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                      />
                    </div>
                  </div>
                </motion.div>

                <motion.div
                  variants={formSectionVariants}
                  initial='hidden'
                  animate='show'
                  transition={{ delay: 0.1 }}
                  className='flex flex-col-reverse items-stretch justify-between gap-4 pt-4 sm:flex-row sm:items-center sm:pt-6'>
                  {eventToEdit ? (
                    <button
                      type='button'
                      onClick={handleDelete}
                      disabled={loading}
                      className='inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-rose-200/50 bg-rose-50 px-4 py-4 text-sm font-medium text-rose-600 transition-all duration-300 hover:-translate-y-1 hover:bg-rose-100 disabled:opacity-50 sm:w-auto'>
                      {t('deleteEvent')}
                    </button>
                  ) : (
                    <div className='hidden sm:block' /> /* Empty div to push right buttons to end on desktop */
                  )}

                  <div className='flex w-full flex-col gap-3 sm:w-auto sm:flex-row'>
                    <button
                      type='button'
                      onClick={onClose}
                      disabled={loading}
                      className='btn w-full sm:w-auto'>
                      {t('restoreCancel')}
                    </button>
                    <button
                      type='submit'
                      disabled={loading}
                      className='btn-primary w-full sm:w-auto'>
                      {loading && <Loader2 className='size-4 animate-spin' />}
                      {loading ? t('savingEvent') : t('saveEvent')}
                    </button>
                  </div>
                </motion.div>
              </form>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
