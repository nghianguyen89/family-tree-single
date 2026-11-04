'use client'

import { Clock, LayoutGrid, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { useI18n } from '@/lib/i18n/I18nProvider'
import { GalleryItem } from '@/types'

import GalleryGrid from './GalleryGrid'
import UploadModal from './modal/UploadModal'

export default function GalleryClient({
  initialItems,
  isAdmin
}: {
  initialItems: GalleryItem[]
  isAdmin: boolean
}) {
  const [viewMode, setViewMode] = useState<'grid' | 'timeline'>('timeline')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<GalleryItem | null>(null)
  const router = useRouter()
  const { t } = useI18n()

  const handleUploadSuccess = () => {
    setIsModalOpen(false)
    setEditingItem(null)
    // Refresh the server component to get new data
    router.refresh()
  }

  const handleDeleteSuccess = () => {
    router.refresh()
  }

  const handleEdit = (item: GalleryItem) => {
    setEditingItem(item)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setEditingItem(null)
  }

  return (
    <>
      <div className='mb-8 flex flex-col items-stretch justify-between gap-4 sm:mb-12 sm:flex-row sm:items-center'>
        <div className='flex items-center gap-3'>
          <div>
            <h1 className='title'>{t('galleryTitle')}</h1>
            <p className='mt-2 text-sm text-stone-500 sm:text-sm'>
              {t('galleryDescription')}
            </p>
          </div>
        </div>

        <div className='flex items-center gap-3'>
          {/* View switcher */}
          <div className='flex items-center rounded-xl border border-stone-200/60 bg-stone-100 p-1'>
            <button
              onClick={() => setViewMode('timeline')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                viewMode === 'timeline'
                  ? 'bg-surface text-stone-900 shadow-xs'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
              title={t('timelineView')}>
              <Clock className='size-4' />
              <span className='xs:inline hidden'>{t('timelineView')}</span>
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                viewMode === 'grid'
                  ? 'bg-surface text-stone-900 shadow-xs'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
              title={t('gridView')}>
              <LayoutGrid className='size-4' />
              <span className='xs:inline hidden'>{t('gridView')}</span>
            </button>
          </div>

          {isAdmin && (
            <button
              onClick={() => setIsModalOpen(true)}
              className='btn-primary whitespace-nowrap'>
              <Plus className='size-5' />
              <span>{t('addImage')}</span>
            </button>
          )}
        </div>
      </div>

      <GalleryGrid
        items={initialItems}
        isAdmin={isAdmin}
        viewMode={viewMode}
        onEdit={handleEdit}
        onDeleteSuccess={handleDeleteSuccess}
      />

      {isModalOpen && (
        <UploadModal
          key={editingItem?.id || 'new'}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          onSuccess={handleUploadSuccess}
          initialData={editingItem}
        />
      )}
    </>
  )
}
