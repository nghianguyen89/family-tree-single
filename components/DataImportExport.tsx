'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Download, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { exportData, importData } from '@/app/actions/data'
import { branchesMessages } from '@/lib/i18n/branches'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { Person } from '@/types'

import PersonSelector from './PersonSelector'

export default function DataImportExport() {
  const { t, locale } = useI18n()
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importStatus, setImportStatus] = useState<{
    type: 'success' | 'error'
    message: string | undefined
  } | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const [persons, setPersons] = useState<Person[]>([])
  const [exportRootId, setExportRootId] = useState<string | null>(null)

  useEffect(() => {
    async function fetchPersons() {
      try {
        const { createClient } = await import('@/utils/supabase/client')
        const supabase = createClient()

        let allFetched: Person[] = []
        let from = 0
        const step = 1000

        while (true) {
          const { data } = await supabase
            .from('persons')
            .select('id, full_name, birth_year, gender, avatar_url, generation')
            .order('birth_year', { ascending: true, nullsFirst: false })
            .order('id')
            .range(from, from + step - 1)

          if (!data || data.length === 0) break
          allFetched = allFetched.concat(data as Person[])
          if (data.length < step) break
          from += step
        }
        setPersons(allFetched)
      } catch (err) {
        console.error('Error fetching persons:', err)
      }
    }
    fetchPersons()
  }, [])

  const handleExport = async (format: 'json' | 'gedcom' | 'csv') => {
    try {
      setIsExporting(true)
      const rootParam = exportRootId || undefined
      const data = await exportData(rootParam)

      if ('error' in data) {
        setExportError(data.error)
        setTimeout(() => setExportError(null), 5000)
        return
      }

      if (
        format !== 'json' &&
        (data.family_branches?.length ||
          data.family_branch_members?.length ||
          data.persons.some((person) => person.family_branch_id) ||
          data.relationships.some(
            (relationship) => relationship.family_branch_id
          ))
      ) {
        setExportError(branchesMessages[locale].backupJsonOnly)
        return
      }

      if (format === 'csv') {
        const { exportToCsvZip } = await import('@/utils/csv')
        // @ts-expect-error: BackupPayload relationships type mismatch with Partial<Relationship>
        const zipBlob = await exportToCsvZip(data)
        const url = URL.createObjectURL(zipBlob)
        const a = document.createElement('a')
        a.href = url
        a.download = `giapha-export-${new Date().toISOString().split('T')[0]}.zip`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        return
      }

      let content = ''
      let type = ''
      let extension = ''

      if (format === 'json') {
        content = JSON.stringify(data, null, 2)
        type = 'application/json'
        extension = 'json'
      } else {
        const { exportToGedcom } = await import('@/utils/gedcom')
        content = exportToGedcom(data)
        type = 'text/plain'
        extension = 'ged'
      }

      const blob = new Blob([content], { type })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `giapha-export-${new Date().toISOString().split('T')[0]}.${extension}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error: unknown) {
      setExportError(
        error instanceof Error ? error.message : t('downloadFailed')
      )
      setTimeout(() => setExportError(null), 5000)
    } finally {
      setIsExporting(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (file.size > 25 * 1024 * 1024) {
        setImportStatus({
          type: 'error',
          message: t('fileTooLarge')
        })
        return
      }
      const fileName = file.name.toLowerCase()
      if (fileName.endsWith('.csv')) {
        setImportStatus({
          type: 'error',
          message: t('csvRestoreZipOnly')
        })
        return
      }

      if (
        !fileName.endsWith('.json') &&
        !fileName.endsWith('.ged') &&
        !fileName.endsWith('.zip')
      ) {
        setImportStatus({
          type: 'error',
          message: t('invalidRestoreFile')
        })
        return
      }
      setSelectedFile(file)
      setShowConfirm(true)
      setImportStatus(null)
    }
  }

  const handleConfirmImport = async () => {
    if (!selectedFile) return

    try {
      setIsImporting(true)
      setImportStatus(null)

      const fileText = await selectedFile.text()
      let payload

      if (selectedFile.name.toLowerCase().endsWith('.ged')) {
        const { parseGedcom } = await import('@/utils/gedcom')
        payload = parseGedcom(fileText)
      } else if (selectedFile.name.toLowerCase().endsWith('.zip')) {
        const { parseCsvZip } = await import('@/utils/csv')
        payload = await parseCsvZip(selectedFile)
      } else {
        payload = JSON.parse(fileText)
      }

      if (!payload.persons || !payload.relationships) {
        throw new Error(t('invalidBackupFile'))
      }

      if (
        !selectedFile.name.toLowerCase().endsWith('.json') &&
        (payload.family_branches?.length ||
          payload.family_branch_members?.length ||
          payload.persons.some(
            (person: { family_branch_id?: string | null }) =>
              person.family_branch_id
          ) ||
          payload.relationships.some(
            (relationship: { family_branch_id?: string | null }) =>
              relationship.family_branch_id
          ))
      ) {
        throw new Error(branchesMessages[locale].backupJsonOnly)
      }

      const result = await importData({
        persons: payload.persons,
        relationships: payload.relationships,
        person_details_private: payload.person_details_private,
        custom_events: payload.custom_events,
        family_branches: payload.family_branches,
        family_branch_members: payload.family_branch_members
      })

      if ('error' in result) {
        setImportStatus({
          type: 'error',
          message: result.error
        })
        setShowConfirm(false)
        setSelectedFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }

      setImportStatus({
        type: 'success',
        message: t('restoreSuccess', {
          persons: result.imported?.persons || 0,
          relationships: result.imported?.relationships || 0
        })
      })
      setShowConfirm(false)
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (error: unknown) {
      setImportStatus({
        type: 'error',
        message: error instanceof Error ? error.message : t('restoreFailed')
      })
      setShowConfirm(false)
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className='space-y-6'>
      <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
        {/* Export Card */}
        <div className='group relative rounded-2xl border border-stone-200/60 bg-surface/80 p-6 transition-shadow'>
          {/* Background Decor */}
          <div className='pointer-events-none absolute inset-0 overflow-hidden rounded-2xl'>
            <div className='absolute top-0 right-0 -mt-16 -mr-16 h-32 w-32 rounded-full bg-amber-200/20 blur-2xl transition-colors group-hover:bg-amber-300/30' />
          </div>

          <div className='relative z-10 mb-4 flex items-start gap-4'>
            <div className='rounded-xl bg-stone-100 p-3 text-stone-600'>
              <Download className='size-6' />
            </div>
            <div>
              <h3 className='text-lg font-semibold text-stone-800'>
                {t('backupData')}
              </h3>
              <p className='mt-1 text-sm text-stone-500'>
                {t('backupDataDescription')}
              </p>
            </div>
          </div>

          <div className='mb-4'>
            <PersonSelector
              persons={persons}
              selectedId={exportRootId}
              onSelect={setExportRootId}
              label={t('exportRoot')}
              className='w-full sm:w-80'
              showAllOption={true}
              allOptionLabel={t('allData')}
            />
          </div>

          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
            <button
              onClick={() => handleExport('json')}
              disabled={isExporting}
              className='btn-primary w-full'>
              {isExporting ? t('processingData') : t('exportJson')}
            </button>
            <button
              onClick={() => handleExport('gedcom')}
              disabled={isExporting}
              className='btn w-full bg-stone-100 font-medium text-stone-700 hover:bg-stone-200'>
              {isExporting ? t('processingData') : t('exportGedcom')}
            </button>
            <button
              onClick={() => handleExport('csv')}
              disabled={isExporting}
              className='btn w-full bg-stone-100 font-medium text-stone-700 hover:bg-stone-200 sm:col-span-2 lg:col-span-1'>
              {isExporting ? t('processingData') : t('exportCsv')}
            </button>
          </div>

          <AnimatePresence>
            {exportError && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className='mt-4'>
                <div className='flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-left text-sm text-red-600'>
                  <AlertTriangle className='h-5 w-5 shrink-0 text-red-500' />
                  <span>{exportError}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Import Card */}
        <div className='group relative rounded-2xl border border-stone-200/60 bg-surface/80 p-6 transition-shadow'>
          {/* Background Decor */}
          <div className='pointer-events-none absolute inset-0 overflow-hidden rounded-2xl'>
            <div className='absolute top-0 right-0 -mt-16 -mr-16 h-32 w-32 rounded-full bg-rose-200/20 blur-2xl transition-colors group-hover:bg-rose-300/30' />
          </div>

          <div className='relative z-10 mb-4 flex items-start gap-4'>
            <div className='rounded-xl bg-rose-50 p-3 text-rose-600'>
              <Upload className='size-6' />
            </div>
            <div>
              <h3 className='text-lg font-semibold text-stone-800'>
                {t('restoreData')}
              </h3>
              <p className='mt-1 text-sm text-stone-500'>
                {t('restoreDataDescription')}
                <span className='ml-1 font-medium text-rose-600'>
                  {t('restoreWarning')}
                </span>
              </p>
            </div>
          </div>

          <input
            type='file'
            accept='.json,.ged,.zip,.csv'
            className='hidden'
            ref={fileInputRef}
            onChange={handleFileChange}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className='btn w-full'>
            {isImporting ? t('processingData') : t('chooseRestoreFile')}
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showConfirm && (
          <div className='fixed inset-0 z-50 flex items-center justify-center p-4'>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className='absolute inset-0 cursor-pointer bg-stone-900/40'
              onClick={() => setShowConfirm(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className='relative z-10 w-full max-w-md rounded-2xl border border-stone-200/60 bg-surface p-6'>
              <div className='mb-5 flex items-start gap-4'>
                <div className='mt-1 shrink-0 rounded-full bg-rose-100/50 p-3 text-rose-600'>
                  <AlertTriangle className='size-6' />
                </div>
                <div>
                  <h3 className='text-lg font-semibold text-stone-800'>
                    {t('restoreConfirmTitle')}
                  </h3>
                  <p className='mt-2 text-sm leading-relaxed text-stone-600'>
                    {t('restoreConfirmText', {
                      file: selectedFile?.name || ''
                    })}
                  </p>
                  <p className='mt-2 text-sm font-medium text-rose-600'>
                    {t('restoreIrreversible')}
                  </p>
                </div>
              </div>

              <div className='mt-6 flex justify-end gap-3'>
                <button
                  onClick={() => setShowConfirm(false)}
                  disabled={isImporting}
                  className='rounded-xl bg-stone-100 px-4 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-200 hover:text-stone-900'>
                  {t('restoreCancel')}
                </button>
                <button
                  onClick={handleConfirmImport}
                  disabled={isImporting}
                  className='rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-rose-700 disabled:opacity-50'>
                  {isImporting ? t('restoring') : t('restoreContinue')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Status messages */}
      <AnimatePresence>
        {importStatus && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`flex items-center gap-3 rounded-xl border p-4 ${
              importStatus.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}>
            {importStatus.type === 'success' ? (
              <CheckCircle2 className='size-5 shrink-0' />
            ) : (
              <AlertTriangle className='size-5 shrink-0' />
            )}
            <p className='text-sm font-medium'>{importStatus.message}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
