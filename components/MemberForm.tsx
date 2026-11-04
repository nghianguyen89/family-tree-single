'use client'

import { AnimatePresence, motion, Variants } from 'framer-motion'
import {
  AlertCircle,
  Briefcase,
  Image as ImageIcon,
  Loader2,
  Lock,
  MapPin,
  Phone,
  Settings2,
  Trash2,
  User
} from 'lucide-react'
import { Lunar, Solar } from 'lunar-javascript'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { updateDescendantGenerationsAction } from '@/app/actions/member'
import AvatarCropDialog from '@/components/AvatarCropDialog'
import BranchLinks from '@/components/branches/BranchLinks'
import MemorialFields from '@/components/MemorialFields'
import YearRangeFields from '@/components/YearRangeFields'
import { branchesMessages } from '@/lib/i18n/branches'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { intakeMessages } from '@/lib/i18n/intake'
import { Gender, Person } from '@/types'
import { MemorialDate } from '@/types/intake'
import { getAvatarStoragePath, getAvatarUrl } from '@/utils/avatar'
import { emptyMemorial, isValidMemorial } from '@/utils/memorial'
import { createClient } from '@/utils/supabase/client'
import { isValidYearRange } from '@/utils/yearRanges'

interface MemberFormProps {
  initialData?: Person
  isEditing?: boolean
  isAdmin?: boolean
  /** Called with the saved person's ID after a successful save. Overrides default router.push. */
  onSuccess?: (personId: string) => void
  /** Called when user clicks Cancel. Overrides default router.back(). */
  onCancel?: () => void
}

export default function MemberForm({
  initialData,
  isEditing = false,
  isAdmin = false,
  onSuccess,
  onCancel
}: MemberFormProps) {
  const router = useRouter()
  const supabase = createClient()
  const { t, locale } = useI18n()
  const intakeText = intakeMessages[locale]
  const [memorial, setMemorial] = useState<MemorialDate>(() => ({
    memorial_day: initialData?.memorial_day ?? null,
    memorial_month: initialData?.memorial_month ?? null,
    memorial_calendar: initialData?.memorial_calendar ?? null,
    memorial_is_leap_month: initialData?.memorial_is_leap_month ?? false,
    memorial_note: initialData?.memorial_note ?? null
  }))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form states
  const [fullName, setFullName] = useState(initialData?.full_name || '')
  const [otherNames, setOtherNames] = useState(initialData?.other_names || '')
  const [gender, setGender] = useState<Gender>(initialData?.gender || 'male')
  const [birthRange, setBirthRange] = useState(
    initialData?.birth_year_from != null
  )
  const [birthFrom, setBirthFrom] = useState<number | ''>(
    initialData?.birth_year_from ?? ''
  )
  const [birthTo, setBirthTo] = useState<number | ''>(
    initialData?.birth_year_to ?? ''
  )
  const [deathRange, setDeathRange] = useState(
    initialData?.death_year_from != null
  )
  const [deathFrom, setDeathFrom] = useState<number | ''>(
    initialData?.death_year_from ?? ''
  )
  const [deathTo, setDeathTo] = useState<number | ''>(
    initialData?.death_year_to ?? ''
  )
  const [birthYear, setBirthYear] = useState<number | ''>(
    initialData?.birth_year || ''
  )
  const [birthMonth, setBirthMonth] = useState<number | ''>(
    initialData?.birth_month || ''
  )
  const [birthDay, setBirthDay] = useState<number | ''>(
    initialData?.birth_day || ''
  )

  const [deathYear, setDeathYear] = useState<number | ''>(
    initialData?.death_year || ''
  )
  const [deathMonth, setDeathMonth] = useState<number | ''>(
    initialData?.death_month || ''
  )
  const [deathDay, setDeathDay] = useState<number | ''>(
    initialData?.death_day || ''
  )

  const [deathLunarYear, setDeathLunarYear] = useState<number | ''>(
    initialData?.death_lunar_year || ''
  )
  const [deathLunarMonth, setDeathLunarMonth] = useState<number | ''>(
    initialData?.death_lunar_month || ''
  )
  const [deathLunarDay, setDeathLunarDay] = useState<number | ''>(
    initialData?.death_lunar_day || ''
  )

  const [isDeceased, setIsDeceased] = useState<boolean>(
    initialData?.is_deceased || false
  )
  const [isInLaw, setIsInLaw] = useState<boolean>(
    initialData?.is_in_law || false
  )

  const [birthOrder, setBirthOrder] = useState<number | ''>(
    initialData?.birth_order || ''
  )
  const [generation, setGeneration] = useState<number | ''>(
    initialData?.generation || ''
  )

  const [updateDescendantGenerations, setUpdateDescendantGenerations] =
    useState(true) // Default to true if they change it

  const hasGenerationChanged =
    !initialData?.family_branch_id &&
    isEditing &&
    initialData?.generation !== undefined &&
    generation !== initialData?.generation &&
    generation !== ''

  const [avatarUrl, setAvatarUrl] = useState(initialData?.avatar_url || '')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    initialData?.avatar_url || null
  )

  const [note, setNote] = useState(initialData?.note || '')
  // Existing photo is only deleted from storage once the form is saved,
  // so cancelling after "Remove photo" doesn't leave a broken avatar.
  const [removeExistingAvatar, setRemoveExistingAvatar] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [avatarSourceFile, setAvatarSourceFile] = useState<File | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  // Bring validation/save errors into view on long forms
  useEffect(() => {
    if (error) {
      errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [error])

  // Release preview object URLs
  useEffect(() => {
    return () => {
      if (avatarPreview?.startsWith('blob:')) URL.revokeObjectURL(avatarPreview)
    }
  }, [avatarPreview])

  // Private fields
  const [phoneNumber, setPhoneNumber] = useState(
    initialData?.phone_number ?? ''
  )
  const [occupation, setOccupation] = useState(initialData?.occupation ?? '')
  const [currentResidence, setCurrentResidence] = useState(
    initialData?.current_residence ?? ''
  )

  const slugify = (str: string) => {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .replace(/([^0-9a-z-\s])/g, '')
      .replace(/(\s+)/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  const handleSolarDeathChange = (
    field: 'day' | 'month' | 'year',
    val: string
  ) => {
    const num = val ? Number(val) : ''
    let d = deathDay
    let m = deathMonth
    let y = deathYear

    if (field === 'day') {
      d = num
      setDeathDay(num)
    } else if (field === 'month') {
      m = num
      setDeathMonth(num)
    } else if (field === 'year') {
      y = num
      setDeathYear(num)
    }

    if (d !== '' && m !== '' && y !== '' && y > 100) {
      try {
        const solar = Solar.fromYmd(y, m, d)
        const lunar = solar.getLunar()
        setDeathLunarDay(lunar.getDay())
        setDeathLunarMonth(Math.abs(lunar.getMonth()))
        setDeathLunarYear(lunar.getYear())
      } catch {
        // Ignore invalid dates
      }
    }
  }

  const handleLunarDeathChange = (
    field: 'day' | 'month' | 'year',
    val: string
  ) => {
    const num = val ? Number(val) : ''
    let d = deathLunarDay
    let m = deathLunarMonth
    let y = deathLunarYear

    if (field === 'day') {
      d = num
      setDeathLunarDay(num)
    } else if (field === 'month') {
      m = num
      setDeathLunarMonth(num)
    } else if (field === 'year') {
      y = num
      setDeathLunarYear(num)
    }

    if (d !== '' && m !== '' && y !== '' && y > 100) {
      try {
        const lunar = Lunar.fromYmd(y, m, d)
        const solar = lunar.getSolar()
        setDeathDay(solar.getDay())
        setDeathMonth(solar.getMonth())
        setDeathYear(solar.getYear())
      } catch {
        // Ignore invalid dates
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (cropFile || loading) return
    setLoading(true)
    setError(null)

    if (
      (birthRange && !isValidYearRange(birthFrom, birthTo)) ||
      (isDeceased && deathRange && !isValidYearRange(deathFrom, deathTo))
    ) {
      setError(t('invalidYearRange'))
      setLoading(false)
      return
    }
    const earliestBirth = birthRange ? birthFrom : birthYear
    const latestDeath = deathRange ? deathTo : deathYear
    if (
      isDeceased &&
      earliestBirth !== '' &&
      latestDeath !== '' &&
      latestDeath < earliestBirth
    ) {
      setError(t('deathBeforeBirth'))
      setLoading(false)
      return
    }
    if (!isValidMemorial({ ...memorial, is_deceased: isDeceased })) {
      setError(intakeText.invalid)
      setLoading(false)
      return
    }
    // Validation
    const isValidDate = (
      day: number | '',
      month: number | '',
      year: number | ''
    ) => {
      if (day !== '' && (day < 1 || day > 31)) return false
      if (month !== '' && (month < 1 || month > 12)) return false
      if (year !== '' && year < 1) return false

      if (day !== '' && month !== '') {
        const currentYear = year !== '' ? year : 2000
        const daysInMonth = new Date(currentYear, month, 0).getDate()
        if (day > daysInMonth) return false
      }
      return true
    }

    if (!birthRange && !isValidDate(birthDay, birthMonth, birthYear)) {
      setError(t('invalidBirthDate'))
      setLoading(false)
      return
    }

    let finalDeathDay = deathDay
    let finalDeathMonth = deathMonth
    let finalDeathYear = deathYear
    let finalDeathLunarDay = deathLunarDay
    let finalDeathLunarMonth = deathLunarMonth
    let finalDeathLunarYear = deathLunarYear

    if (deathRange) {
      finalDeathDay = ''
      finalDeathMonth = ''
      finalDeathYear = ''
      finalDeathLunarDay = ''
      finalDeathLunarMonth = ''
      finalDeathLunarYear = ''
    } else if (
      isDeceased &&
      deathLunarDay !== '' &&
      deathLunarMonth !== '' &&
      deathLunarYear !== '' &&
      (deathDay === '' || deathMonth === '' || deathYear === '')
    ) {
      try {
        const lunarDate = Lunar.fromYmd(
          deathLunarYear,
          deathLunarMonth,
          deathLunarDay
        )
        const solarDate = lunarDate.getSolar()
        finalDeathDay = solarDate.getDay()
        finalDeathMonth = solarDate.getMonth()
        finalDeathYear = solarDate.getYear()
      } catch {
        setError(t('invalidLunarDate'))
        setLoading(false)
        return
      }
    } else if (
      isDeceased &&
      deathDay !== '' &&
      deathMonth !== '' &&
      deathYear !== '' &&
      (deathLunarDay === '' || deathLunarMonth === '' || deathLunarYear === '')
    ) {
      // Sync from Solar back to Lunar
      try {
        const solarDate = Solar.fromYmd(deathYear, deathMonth, deathDay)
        const lunarDate = solarDate.getLunar()
        finalDeathLunarDay = lunarDate.getDay()
        finalDeathLunarMonth = Math.abs(lunarDate.getMonth())
        finalDeathLunarYear = lunarDate.getYear()
      } catch {
        // Safe fallback if conversion fails
      }
    } else if (!isDeceased) {
      // Clear all
      finalDeathDay = ''
      finalDeathMonth = ''
      finalDeathYear = ''
      finalDeathLunarDay = ''
      finalDeathLunarMonth = ''
      finalDeathLunarYear = ''
    }

    if (
      isDeceased &&
      !isValidDate(finalDeathDay, finalDeathMonth, finalDeathYear)
    ) {
      setError(t('invalidDeathDate'))
      setLoading(false)
      return
    }

    if (
      isDeceased &&
      earliestBirth !== '' &&
      finalDeathYear !== '' &&
      finalDeathYear < earliestBirth
    ) {
      setError(t('deathBeforeBirth'))
      setLoading(false)
      return
    }

    try {
      let currentAvatarUrl = avatarUrl

      // Update person data helper to avoid duplication
      const getPersonData = (url: string | null) => ({
        ...(isDeceased ? memorial : emptyMemorial()),
        full_name: fullName,
        gender,
        birth_year_from: birthRange ? Number(birthFrom) : null,
        birth_year_to: birthRange ? Number(birthTo) : null,
        death_year_from: isDeceased && deathRange ? Number(deathFrom) : null,
        death_year_to: isDeceased && deathRange ? Number(deathTo) : null,
        birth_year: birthRange || birthYear === '' ? null : Number(birthYear),
        birth_month:
          birthRange || birthMonth === '' ? null : Number(birthMonth),
        birth_day: birthRange || birthDay === '' ? null : Number(birthDay),
        death_year:
          isDeceased && finalDeathYear !== '' ? Number(finalDeathYear) : null,
        death_month:
          isDeceased && finalDeathMonth !== '' ? Number(finalDeathMonth) : null,
        death_day:
          isDeceased && finalDeathDay !== '' ? Number(finalDeathDay) : null,
        death_lunar_year:
          isDeceased && finalDeathLunarYear !== ''
            ? Number(finalDeathLunarYear)
            : null,
        death_lunar_month:
          isDeceased && finalDeathLunarMonth !== ''
            ? Number(finalDeathLunarMonth)
            : null,
        death_lunar_day:
          isDeceased && finalDeathLunarDay !== ''
            ? Number(finalDeathLunarDay)
            : null,
        is_deceased: isDeceased,
        is_in_law: initialData?.family_branch_id
          ? initialData.is_in_law
          : isInLaw,
        birth_order: birthOrder === '' ? null : Number(birthOrder),
        generation: initialData?.family_branch_id
          ? null
          : generation === ''
            ? null
            : Number(generation),
        other_names: otherNames || null,
        avatar_url: url,
        note: note || null
      })

      let currentPersonId = initialData?.id

      // For a new member, we must insert first to get the ID for the avatar filename
      if (!isEditing || !currentPersonId) {
        const { data: newPerson, error: createError } = await supabase
          .from('persons')
          .insert(getPersonData(currentAvatarUrl || null))
          .select()
          .single()
        if (createError) throw createError
        currentPersonId = newPerson.id
      } else {
        // Update existing member info first
        const { error: updateError } = await supabase
          .from('persons')
          .update(getPersonData(currentAvatarUrl || null))
          .eq('id', currentPersonId)
        if (updateError) throw updateError
      }

      // 2. Handle Avatar Upload if a new file is selected (now we have currentPersonId)
      if (avatarFile && currentPersonId) {
        const fileExt = avatarFile.name.split('.').pop()
        const slugName = slugify(fullName)
        const fileName = `${currentPersonId}_${slugName}.${fileExt}`
        const filePath = `${fileName}`

        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, avatarFile, { upsert: true })

        if (uploadError) throw uploadError

        currentAvatarUrl = filePath

        // Update the person with the final avatar URL
        const { error: updateAvatarError } = await supabase
          .from('persons')
          .update({ avatar_url: currentAvatarUrl })
          .eq('id', currentPersonId)
        if (updateAvatarError) throw updateAvatarError
      }

      // Delete the previous photo from storage only after a successful save
      if (removeExistingAvatar && initialData?.avatar_url) {
        const filePath = getAvatarStoragePath(initialData.avatar_url)
        const replacedSameFile = filePath && filePath === currentAvatarUrl
        if (filePath && !replacedSameFile) {
          const { error: removeError } = await supabase.storage
            .from('avatars')
            .remove([filePath])
          if (removeError) {
            console.error('Error removing avatar from storage:', removeError)
          }
        }
      }

      // 3. Upsert private data (only if admin and currentPersonId exists)
      if (isAdmin && currentPersonId) {
        const normalizedData = {
          person_id: currentPersonId,
          phone_number: phoneNumber?.trim() || null,
          occupation: occupation?.trim() || null,
          current_residence: currentResidence?.trim() || null
        }

        const hasData =
          normalizedData.phone_number ||
          normalizedData.occupation ||
          normalizedData.current_residence

        if (hasData) {
          const { error } = await supabase
            .from('person_details_private')
            .upsert(normalizedData)

          if (error) throw error
        } else {
          const { error } = await supabase
            .from('person_details_private')
            .delete()
            .eq('person_id', currentPersonId)

          if (error) throw error
        }
      }

      // 4. Update descendants' generations if checked and changed
      if (
        hasGenerationChanged &&
        updateDescendantGenerations &&
        currentPersonId
      ) {
        const delta = Number(generation) - (initialData?.generation || 0)
        if (delta !== 0) {
          const res = await updateDescendantGenerationsAction(
            currentPersonId,
            delta
          )
          if (res.error) {
            throw new Error(res.error)
          }
        }
      }

      // After save: use callback if provided, otherwise fall back to page navigation

      if (!currentPersonId) throw new Error(t('saveIdError'))
      if (onSuccess) {
        onSuccess(currentPersonId)
      } else {
        router.push('/dashboard/members/' + currentPersonId)
        router.refresh()
      }
    } catch (err) {
      console.error('Error saving member:', err)
      const saveError = err as { message?: string; code?: string }
      setError(
        saveError.code === 'PGRST204' &&
          /memorial_/.test(saveError.message || '')
          ? intakeText.migration
          : saveError.code === 'PGRST204' &&
              /year_(from|to)/.test(saveError.message || '')
            ? t('yearRangeMigrationRequired')
            : saveError.message || t('saveMemberError')
      )
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

  const form = (
    <form onSubmit={handleSubmit} className='space-y-6 sm:space-y-8'>
      {cropFile && (
        <AvatarCropDialog
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onConfirm={(cropped) => {
            if (initialData?.avatar_url) setRemoveExistingAvatar(true)
            setAvatarSourceFile(cropFile)
            setAvatarFile(cropped)
            setAvatarPreview(URL.createObjectURL(cropped))
            setCropFile(null)
          }}
        />
      )}
      <motion.div
        variants={formSectionVariants}
        initial='hidden'
        animate='show'
        className='rounded-2xl border border-stone-200/80 bg-surface/80 p-5 sm:p-8'>
        <h3 className='mb-6 flex items-center gap-2 border-b border-stone-100 pb-4 font-serif text-lg font-semibold text-stone-800 sm:text-xl'>
          <User className='size-5 text-amber-600' />
          {t('generalInfo')}
        </h3>
        <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
          <div className='md:col-span-1'>
            <label className='mb-1.5 block text-sm font-medium text-stone-700'>
              {t('fullName')} <span className='text-red-500'>*</span>
            </label>
            <input
              type='text'
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={inputClasses}
              placeholder={t('fullNamePlaceholder')}
            />
          </div>

          <div className='md:col-span-1'>
            <label className='mb-1.5 block text-sm font-medium text-stone-700'>
              {t('otherNames')}
            </label>
            <input
              type='text'
              value={otherNames}
              onChange={(e) => setOtherNames(e.target.value)}
              className={inputClasses}
              placeholder={t('otherNamesPlaceholder')}
            />
          </div>

          <div>
            <label className='mb-1.5 block text-sm font-medium text-stone-700'>
              {t('gender')} <span className='text-red-500'>*</span>
            </label>
            <div className='relative'>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as Gender)}
                className={`${inputClasses} appearance-none`}>
                <option value='male'>{t('male')}</option>
                <option value='female'>{t('female')}</option>
                <option value='other'>{t('otherGender')}</option>
              </select>
              <div className='pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-stone-500'>
                <Settings2 className='size-4' />
              </div>
            </div>
          </div>

          <div className='mt-2 flex items-center sm:mt-7'>
            <label className='group flex items-center gap-3'>
              <div className='relative flex items-center'>
                <input
                  type='checkbox'
                  checked={isInLaw}
                  disabled={!!initialData?.family_branch_id}
                  onChange={(e) => setIsInLaw(e.target.checked)}
                  className='peer sr-only'
                />
                <div className='flex size-5 items-center justify-center rounded border-2 border-stone-300 transition-colors peer-checked:border-amber-500 peer-checked:bg-amber-500'>
                  <motion.svg
                    initial={false}
                    animate={{
                      opacity: isInLaw ? 1 : 0,
                      scale: isInLaw ? 1 : 0.5
                    }}
                    className='pointer-events-none size-3 text-white'
                    fill='none'
                    viewBox='0 0 24 24'
                    stroke='currentColor'
                    strokeWidth={4}>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      d='M5 13l4 4L19 7'
                    />
                  </motion.svg>
                </div>
              </div>
              <span className='text-sm font-medium text-stone-700 transition-colors group-hover:text-amber-700'>
                {t('inLaw')}
              </span>
            </label>
          </div>

          <div>
            <label className='mb-1.5 block text-sm font-medium text-stone-700'>
              {t('birthOrder')}
            </label>
            <input
              type='number'
              min='1'
              placeholder={t('birthOrderPlaceholder')}
              value={birthOrder}
              onChange={(e) =>
                setBirthOrder(e.target.value ? Number(e.target.value) : '')
              }
              className={inputClasses}
            />
            <p className='mt-1.5 flex items-center gap-1 text-sm text-stone-400'>
              <span>💡</span> {t('leaveBlank')}
            </p>
          </div>

          <div>
            <label className='mb-1.5 block text-sm font-medium text-stone-700'>
              {t('generation')}
            </label>
            <input
              type='number'
              min='1'
              placeholder={t('generationPlaceholder')}
              value={generation}
              disabled={!!initialData?.family_branch_id}
              onChange={(e) =>
                setGeneration(e.target.value ? Number(e.target.value) : '')
              }
              className={inputClasses}
            />
            {initialData?.family_branch_id && (
              <p className='mt-2 text-sm text-secondary'>
                {branchesMessages[locale].profileScopeHint}
              </p>
            )}
            <p className='mt-1.5 flex items-center gap-1 text-sm text-stone-400'>
              <span>💡</span> {t('leaveBlank')}
            </p>

            <AnimatePresence>
              {hasGenerationChanged && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  className='overflow-hidden'>
                  <label className='group flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200/60 bg-amber-50/50 p-3'>
                    <div className='relative mt-0.5 flex items-center'>
                      <input
                        type='checkbox'
                        checked={updateDescendantGenerations}
                        onChange={(e) =>
                          setUpdateDescendantGenerations(e.target.checked)
                        }
                        className='peer sr-only'
                      />
                      <div className='flex size-4 items-center justify-center rounded border-2 border-stone-300 transition-colors peer-checked:border-amber-500 peer-checked:bg-amber-500 sm:size-5'>
                        <motion.svg
                          initial={false}
                          animate={{
                            opacity: updateDescendantGenerations ? 1 : 0,
                            scale: updateDescendantGenerations ? 1 : 0.5
                          }}
                          className='pointer-events-none size-3 text-white'
                          fill='none'
                          viewBox='0 0 24 24'
                          stroke='currentColor'
                          strokeWidth={4}>
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            d='M5 13l4 4L19 7'
                          />
                        </motion.svg>
                      </div>
                    </div>
                    <div className='flex-1'>
                      <span className='block text-sm font-medium text-stone-700 transition-colors group-hover:text-amber-700'>
                        {t('updateDescendant')}
                      </span>
                      <p className='mt-1 text-sm text-stone-500'>
                        {t('updateDescendantDescription')}
                      </p>
                    </div>
                  </label>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className='mt-2 md:col-span-2'>
            <label className='mb-2.5 block text-sm font-medium text-stone-700'>
              {t('avatar')}
            </label>
            <div className='flex flex-col items-start gap-5 rounded-xl border border-stone-100 bg-stone-50/50 p-4 sm:flex-row sm:items-center'>
              <div
                className={`flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-surface text-sm font-medium text-white sm:h-24 sm:w-24 ${!avatarPreview ? (gender === 'male' ? 'bg-linear-to-br from-sky-400 to-sky-700' : gender === 'female' ? 'bg-linear-to-br from-rose-400 to-rose-700' : 'bg-linear-to-br from-stone-400 to-stone-600') : ''}`}>
                {avatarPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={
                      avatarPreview.startsWith('blob:')
                        ? avatarPreview
                        : getAvatarUrl(avatarPreview) || undefined
                    }
                    alt='Avatar preview'
                    className='h-full w-full object-cover'
                  />
                ) : (
                  <span className='opacity-90'>
                    {fullName ? fullName.charAt(0).toUpperCase() : '?'}
                  </span>
                )}
              </div>
              <div className='w-full flex-1'>
                <div className='flex flex-wrap items-center gap-3'>
                  <div className='relative'>
                    <input
                      type='file'
                      accept='image/jpeg,image/png,image/gif,image/webp'
                      aria-label={t('chooseNewPhoto')}
                      disabled={loading || !!cropFile}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file) {
                          if (
                            ![
                              'image/jpeg',
                              'image/png',
                              'image/gif',
                              'image/webp'
                            ].includes(file.type)
                          ) {
                            setError(t('invalidImageType'))
                            return
                          }
                          if (file.size > 20 * 1024 * 1024) {
                            setError(t('imageTooLarge'))
                            return
                          }
                          setError(null)
                          setCropFile(file)
                        }
                      }}
                      className='absolute inset-0 h-full w-full opacity-0'
                    />
                    <button
                      type='button'
                      className='flex items-center gap-2 rounded-lg border border-amber-200/50 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 transition-colors hover:border-amber-300 hover:bg-amber-100'>
                      <ImageIcon className='size-4' />
                      {t('chooseNewPhoto')}
                    </button>
                  </div>
                  {avatarSourceFile && (
                    <button
                      type='button'
                      disabled={loading}
                      className='btn'
                      onClick={() => setCropFile(avatarSourceFile)}>
                      {t('cropAvatarEdit')}
                    </button>
                  )}
                  {avatarPreview && (
                    <button
                      type='button'
                      onClick={() => {
                        if (initialData?.avatar_url) {
                          setRemoveExistingAvatar(true)
                        }
                        setAvatarUrl('')
                        setAvatarFile(null)
                        setAvatarSourceFile(null)
                        setAvatarPreview(null)
                      }}
                      className='flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-100 hover:text-rose-700'>
                      <Trash2 className='size-4' />
                      {t('removePhoto')}
                    </button>
                  )}
                </div>
                <p className='mt-2.5 flex items-center gap-1.5 text-sm text-stone-500'>
                  <AlertCircle className='h-3.5 w-3.5 text-stone-400' />
                  {t('imageSupport')}
                </p>
              </div>
            </div>
          </div>

          <div className='md:col-span-2'>
            <label className='mb-1.5 block text-sm font-medium text-stone-700'>
              {t('solarBirthDate')}
            </label>
            <label className='mb-4 flex items-center gap-2 text-sm text-stone-600'>
              <input
                type='checkbox'
                checked={birthRange}
                onChange={(e) => setBirthRange(e.target.checked)}
                className='accent-amber-600'
              />
              {t('useYearRange')}
            </label>
            {birthRange ? (
              <YearRangeFields
                from={birthFrom}
                to={birthTo}
                onFromChange={setBirthFrom}
                onToChange={setBirthTo}
              />
            ) : (
              <div className='grid grid-cols-3 gap-3'>
                <input
                  type='number'
                  placeholder={t('day')}
                  min='1'
                  max='31'
                  value={birthDay}
                  onChange={(e) =>
                    setBirthDay(e.target.value ? Number(e.target.value) : '')
                  }
                  className={inputClasses}
                />
                <input
                  type='number'
                  placeholder={t('month')}
                  min='1'
                  max='12'
                  value={birthMonth}
                  onChange={(e) =>
                    setBirthMonth(e.target.value ? Number(e.target.value) : '')
                  }
                  className={inputClasses}
                />
                <input
                  type='number'
                  placeholder={t('year')}
                  value={birthYear}
                  onChange={(e) =>
                    setBirthYear(e.target.value ? Number(e.target.value) : '')
                  }
                  className={inputClasses}
                />
              </div>
            )}
          </div>

          <div className='rounded-2xl border border-stone-200/60 bg-stone-50/50 p-5 md:col-span-2'>
            <div className='flex flex-col gap-4'>
              <label className='group flex items-center gap-3'>
                <div className='relative flex items-center'>
                  <input
                    type='checkbox'
                    checked={isDeceased}
                    onChange={(e) => {
                      setIsDeceased(e.target.checked)
                      if (!e.target.checked) {
                        setMemorial(emptyMemorial())
                        setDeathRange(false)
                        setDeathFrom('')
                        setDeathTo('')
                        setDeathYear('')
                        setDeathMonth('')
                        setDeathDay('')
                        setDeathLunarYear('')
                        setDeathLunarMonth('')
                        setDeathLunarDay('')
                      }
                    }}
                    className='peer sr-only'
                  />
                  <div className='flex size-5 items-center justify-center rounded border-2 border-stone-300 transition-colors peer-checked:border-stone-600 peer-checked:bg-stone-600'>
                    <motion.svg
                      initial={false}
                      animate={{
                        opacity: isDeceased ? 1 : 0,
                        scale: isDeceased ? 1 : 0.5
                      }}
                      className='pointer-events-none size-3 text-white'
                      fill='none'
                      viewBox='0 0 24 24'
                      stroke='currentColor'
                      strokeWidth={4}>
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        d='M5 13l4 4L19 7'
                      />
                    </motion.svg>
                  </div>
                </div>
                <span className='text-sm font-medium text-stone-700 transition-colors group-hover:text-stone-900'>
                  {t('deceasedStatus')}
                </span>
              </label>
            </div>

            <AnimatePresence>
              {isDeceased && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginTop: 20 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  className='overflow-hidden'>
                  <p className='mb-4 text-sm text-stone-500 italic'>
                    {t('dateHint')}
                  </p>

                  <label className='mb-4 flex items-center gap-2 text-sm text-stone-600'>
                    <input
                      type='checkbox'
                      checked={deathRange}
                      onChange={(e) => setDeathRange(e.target.checked)}
                      className='accent-amber-600'
                    />
                    {t('useYearRange')}
                  </label>
                  {deathRange ? (
                    <YearRangeFields
                      from={deathFrom}
                      to={deathTo}
                      onFromChange={setDeathFrom}
                      onToChange={setDeathTo}
                    />
                  ) : (
                    <div className='flex flex-col gap-5'>
                      {/* Lunar Date */}
                      <div>
                        <label className='mb-2 block text-sm font-medium text-stone-700'>
                          {t('lunarDeathDate')}
                        </label>
                        <div className='grid grid-cols-3 gap-3'>
                          <input
                            type='number'
                            placeholder={t('day')}
                            min='1'
                            max='31'
                            value={deathLunarDay}
                            onChange={(e) =>
                              handleLunarDeathChange('day', e.target.value)
                            }
                            className={inputClasses}
                          />
                          <input
                            type='number'
                            placeholder={t('month')}
                            min='1'
                            max='12'
                            value={deathLunarMonth}
                            onChange={(e) =>
                              handleLunarDeathChange('month', e.target.value)
                            }
                            className={inputClasses}
                          />
                          <input
                            type='number'
                            placeholder={t('year')}
                            value={deathLunarYear}
                            onChange={(e) =>
                              handleLunarDeathChange('year', e.target.value)
                            }
                            className={inputClasses}
                          />
                        </div>
                      </div>

                      {/* Solar Date */}
                      <div>
                        <label className='mb-2 block text-sm font-medium text-stone-700'>
                          {t('solarDeathDate')}
                        </label>
                        <div className='grid grid-cols-3 gap-3'>
                          <input
                            type='number'
                            placeholder={t('day')}
                            min='1'
                            max='31'
                            value={deathDay}
                            onChange={(e) =>
                              handleSolarDeathChange('day', e.target.value)
                            }
                            className={inputClasses}
                          />
                          <input
                            type='number'
                            placeholder={t('month')}
                            min='1'
                            max='12'
                            value={deathMonth}
                            onChange={(e) =>
                              handleSolarDeathChange('month', e.target.value)
                            }
                            className={inputClasses}
                          />
                          <input
                            type='number'
                            placeholder={t('year')}
                            value={deathYear}
                            onChange={(e) =>
                              handleSolarDeathChange('year', e.target.value)
                            }
                            className={inputClasses}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  <div className='mt-4'>
                    <MemorialFields value={memorial} onChange={setMemorial} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className='md:col-span-2'>
            <label className='mb-1.5 block text-sm font-medium text-stone-700'>
              {t('note')}
            </label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('notePlaceholder')}
              className={`${inputClasses} resize-none`}
            />
          </div>
        </div>
      </motion.div>

      {/* Private Information Section (Admin Only) */}
      {isAdmin && (
        <motion.div
          variants={formSectionVariants}
          initial='hidden'
          animate='show'
          transition={{ delay: 0.1 }}
          className='relative overflow-hidden rounded-2xl border border-amber-200/50 bg-linear-to-br from-amber-50/80 to-stone-50/80 p-5 sm:p-8'>
          {/* Decorative Background Icon */}
          <Lock className='absolute -right-6 -bottom-6 h-32 w-32 rotate-12 text-amber-500/5' />

          <h3 className='relative z-10 mb-6 flex items-center gap-2 border-b border-amber-200/50 pb-4 font-serif text-lg font-semibold text-amber-900 sm:text-xl'>
            <span className='rounded-lg bg-amber-100/80 p-1.5 text-amber-700 shadow-xs'>
              <Lock className='size-4' />
            </span>
            <span>{t('privateInfo')}</span>
            <span className='ml-auto rounded-md border border-amber-300/60 bg-amber-200/80 px-2.5 py-1 text-sm font-medium text-amber-800 sm:ml-2'>
              {t('adminOnly')}
            </span>
          </h3>
          <div className='relative z-10 grid grid-cols-1 gap-6 md:grid-cols-2'>
            <div>
              <label className='mb-1.5 flex items-center gap-1.5 text-sm font-medium text-amber-900/80'>
                <Phone className='size-4' /> {t('phone')}
              </label>
              <input
                type='tel'
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                disabled={isDeceased}
                placeholder={t('phonePlaceholder')}
                className={`${inputClasses} disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400`}
              />
              {isDeceased && (
                <p className='mt-1.5 flex items-center gap-1 text-sm font-medium text-rose-500'>
                  <AlertCircle className='size-3' />
                  {t('deceasedPhone')}
                </p>
              )}
            </div>

            <div>
              <label className='mb-1.5 flex items-center gap-1.5 text-sm font-medium text-amber-900/80'>
                <Briefcase className='size-4' /> {t('occupation')}
              </label>
              <input
                type='text'
                value={occupation}
                onChange={(e) => setOccupation(e.target.value)}
                placeholder={t('occupationPlaceholder')}
                className={inputClasses}
              />
            </div>

            <div className='md:col-span-2'>
              <label className='mb-1.5 flex items-center gap-1.5 text-sm font-medium text-amber-900/80'>
                <MapPin className='size-4' /> {t('residence')}
              </label>
              <input
                type='text'
                value={currentResidence}
                onChange={(e) => setCurrentResidence(e.target.value)}
                placeholder={t('residencePlaceholder')}
                className={inputClasses}
              />
            </div>
          </div>
        </motion.div>
      )}

      <AnimatePresence>
        {error && (
          <motion.div
            ref={errorRef}
            role='alert'
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className='flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700'>
            <AlertCircle className='mt-0.5 size-5 shrink-0' />
            <p>{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        variants={formSectionVariants}
        initial='hidden'
        animate='show'
        transition={{ delay: 0.2 }}
        className='flex justify-end gap-3 pt-6 sm:gap-4'>
        <button
          type='button'
          onClick={() => (onCancel ? onCancel() : router.back())}
          className='btn'>
          {t('cancel')}
        </button>
        <button
          type='submit'
          disabled={loading || !!cropFile}
          className='btn-primary disabled:pointer-events-none disabled:opacity-60'>
          {loading && <Loader2 className='size-4 animate-spin' />}
          {loading
            ? t('saving')
            : isEditing
              ? t('saveChanges')
              : t('addMember')}
        </button>
      </motion.div>
    </form>
  )
  return (
    <>
      {form}
      {isEditing && initialData?.family_branch_id && (
        <div className='mt-6'>
          <BranchLinks person={initialData} canEdit={true} />
        </div>
      )}
    </>
  )
}
