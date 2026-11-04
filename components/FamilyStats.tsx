'use client'

import { motion } from 'framer-motion'
import {
  Crown,
  Flower2,
  Heart,
  HeartOff,
  Mars,
  Moon,
  Skull,
  Star,
  Users,
  Venus
} from 'lucide-react'
import { useMemo } from 'react'

import { useI18n } from '@/lib/i18n/I18nProvider'
import { Person, Relationship } from '@/types'
import { getZodiacAnimal, getZodiacSign } from '@/utils/dateHelpers'

interface FamilyStatsProps {
  persons: Person[]
  relationships: Relationship[]
}

interface StatCardProps {
  label: string
  value: number
  total: number
  icon: React.ReactNode
  color: string
  delay?: number
}

function StatCard({
  label,
  value,
  total,
  icon,
  color,
  delay = 0
}: StatCardProps) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className='group relative overflow-hidden rounded-3xl border border-stone-200/60 bg-surface/80 p-5 transition-all hover:-translate-y-1'>
      {/* Background glow */}
      <div
        className={`absolute -top-6 -right-6 size-24 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-30 ${color}`}
      />

      <div className='relative z-10 mb-3 flex items-start justify-between'>
        <div className={`rounded-xl p-2.5 ${color} bg-opacity-10`}>{icon}</div>
        <span className='rounded-full bg-stone-100 px-2 py-1 text-sm font-medium text-stone-400'>
          {pct}%
        </span>
      </div>

      <p className='relative z-10 text-sm font-medium text-stone-800'>
        {value}
      </p>
      <p className='relative z-10 mt-0.5 text-sm font-medium text-stone-500'>
        {label}
      </p>

      {/* Progress bar */}
      <div className='relative z-10 mt-3 h-1.5 overflow-hidden rounded-full bg-stone-100'>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, delay: delay + 0.2, ease: 'easeOut' }}
          className={`h-full rounded-full ${color}`}
        />
      </div>
    </motion.div>
  )
}

// Generation breakdown row
function GenerationRow({
  gen,
  count,
  max,
  delay
}: {
  gen: number
  count: number
  max: number
  delay: number
}) {
  const { t } = useI18n()
  const pct = max > 0 ? (count / max) * 100 : 0
  return (
    <div className='flex items-center gap-3'>
      <span className='w-14 shrink-0 text-sm font-medium text-stone-500'>
        {t('generationLabel', { generation: gen })}
      </span>
      <div className='h-2 flex-1 overflow-hidden rounded-full bg-stone-100'>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, delay, ease: 'easeOut' }}
          className='h-full rounded-full bg-amber-400'
        />
      </div>
      <span className='w-8 shrink-0 text-right text-sm font-medium text-stone-700'>
        {count}
      </span>
    </div>
  )
}

export default function FamilyStats({
  persons,
  relationships
}: FamilyStatsProps) {
  const { t } = useI18n()
  const stats = useMemo(() => {
    const total = persons.length

    // Gender
    const male = persons.filter((p) => p.gender === 'male').length
    const female = persons.filter((p) => p.gender === 'female').length

    // In-laws
    const daughtersInLaw = persons.filter(
      (p) => p.is_in_law && p.gender === 'female'
    ).length
    const sonsInLaw = persons.filter(
      (p) => p.is_in_law && p.gender === 'male'
    ).length

    // Deceased
    const deceased = persons.filter((p) => p.is_deceased).length

    // First-born (con trưởng)
    const firstBorn = persons.filter((p) => p.birth_order === 1).length

    // Married / unmarried (based on marriage relationships)
    const marriedIds = new Set<string>()
    relationships
      .filter((r) => r.type === 'marriage')
      .forEach((r) => {
        marriedIds.add(r.person_a)
        marriedIds.add(r.person_b)
      })
    const married = persons.filter((p) => marriedIds.has(p.id)).length
    const unmarried = total - married

    // Generation breakdown
    const genMap = new Map<number, number>()
    const zodiacMap = new Map<string, number>()
    const chineseZodiacMap = new Map<string, number>()

    persons.forEach((p) => {
      // Generations
      if (p.generation != null) {
        genMap.set(p.generation, (genMap.get(p.generation) ?? 0) + 1)
      }

      // Zodiac Signs
      const zodiac = getZodiacSign(p.birth_day, p.birth_month)
      if (zodiac) {
        zodiacMap.set(zodiac, (zodiacMap.get(zodiac) ?? 0) + 1)
      }

      // Chinese Zodiac
      const chineseZodiac = getZodiacAnimal(
        p.birth_year,
        p.birth_month,
        p.birth_day
      )
      if (chineseZodiac) {
        chineseZodiacMap.set(
          chineseZodiac,
          (chineseZodiacMap.get(chineseZodiac) ?? 0) + 1
        )
      }
    })

    const generationBreakdown = Array.from(genMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([gen, count]) => ({ gen, count }))

    const zodiacBreakdown = Array.from(zodiacMap.entries())
      .sort((a, b) => b[1] - a[1]) // Sort by count descending
      .map(([name, count]) => ({ name, count }))

    const chineseZodiacBreakdown = Array.from(chineseZodiacMap.entries())
      .sort((a, b) => b[1] - a[1]) // Sort by count descending
      .map(([name, count]) => ({ name, count }))

    return {
      total,
      male,
      female,
      daughtersInLaw,
      sonsInLaw,
      deceased,
      firstBorn,
      married,
      unmarried,
      generationBreakdown,
      zodiacBreakdown,
      chineseZodiacBreakdown
    }
  }, [persons, relationships])

  const cards = [
    {
      label: t('totalMembers'),
      value: stats.total,
      icon: <Users className='size-5 text-stone-600' />,
      color: 'bg-stone-400'
    },
    {
      label: t('male'),
      value: stats.male,
      icon: <Mars className='size-5 text-blue-600' />,
      color: 'bg-blue-400'
    },
    {
      label: t('female'),
      value: stats.female,
      icon: <Venus className='size-5 text-pink-500' />,
      color: 'bg-pink-400'
    },
    {
      label: t('daughterInLawChild'),
      value: stats.daughtersInLaw,
      icon: <Flower2 className='size-5 text-rose-500' />,
      color: 'bg-rose-400'
    },
    {
      label: t('sonInLawChild'),
      value: stats.sonsInLaw,
      icon: <Users className='size-5 text-indigo-500' />,
      color: 'bg-indigo-400'
    },
    {
      label: t('married'),
      value: stats.married,
      icon: <Heart className='size-5 text-red-500' />,
      color: 'bg-red-400'
    },
    {
      label: t('unmarried'),
      value: stats.unmarried,
      icon: <HeartOff className='size-5 text-stone-400' />,
      color: 'bg-stone-300'
    },
    {
      label: t('deceased'),
      value: stats.deceased,
      icon: <Skull className='size-5 text-stone-500' />,
      color: 'bg-stone-400'
    },
    {
      label: t('firstChild'),
      value: stats.firstBorn,
      icon: <Crown className='size-5 text-amber-500' />,
      color: 'bg-amber-400'
    }
  ]

  return (
    <div className='space-y-8'>
      {/* Stat Cards Grid */}
      <div className='grid grid-cols-2 gap-4 sm:grid-cols-3'>
        {cards.map((card, i) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            total={stats.total}
            icon={card.icon}
            color={card.color}
            delay={i * 0.06}
          />
        ))}
      </div>

      {/* Generation Breakdown */}
      {stats.generationBreakdown.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.5 }}
          className='card-feature'>
          <h2 className='mb-5 flex items-center gap-2 text-base font-semibold text-stone-700'>
            <Crown className='size-4 text-amber-500' />
            {t('generationDistribution')}
          </h2>
          <div className='space-y-3'>
            {stats.generationBreakdown.map(({ gen, count }, i) => (
              <GenerationRow
                key={gen}
                gen={gen}
                count={count}
                max={stats.total}
                delay={0.55 + i * 0.07}
              />
            ))}
          </div>
          <p className='mt-4 text-sm text-stone-400 italic'>
            {t('generationAssignedHint')}
          </p>
        </motion.div>
      )}

      {/* Gender ratio visual */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.65 }}
        className='rounded-2xl border border-stone-200/60 bg-surface/80 p-6'>
        <h2 className='mb-5 flex items-center gap-2 text-base font-semibold text-stone-700'>
          <Users className='size-4 text-stone-500' />
          {t('genderRatio')}
        </h2>
        <div className='flex h-5 gap-px overflow-hidden rounded-full'>
          {stats.total > 0 && (
            <>
              <motion.div
                initial={{ flex: 0 }}
                animate={{ flex: stats.male }}
                transition={{ duration: 0.7, delay: 0.7 }}
                className='flex items-center justify-center bg-blue-400'
                title={`${t('male')}: ${stats.male}`}
              />
              <motion.div
                initial={{ flex: 0 }}
                animate={{ flex: stats.female }}
                transition={{ duration: 0.7, delay: 0.7 }}
                className='flex items-center justify-center bg-pink-400'
                title={`${t('female')}: ${stats.female}`}
              />
            </>
          )}
        </div>
        <div className='mt-3 flex gap-6 text-sm'>
          <span className='flex items-center gap-2 text-stone-600'>
            <span className='inline-block size-3 rounded-full bg-blue-400' />
            {t('male')} — {t('peopleCount', { count: stats.male })} (
            {stats.total > 0 ? Math.round((stats.male / stats.total) * 100) : 0}
            %)
          </span>
          <span className='flex items-center gap-2 text-stone-600'>
            <span className='inline-block size-3 rounded-full bg-pink-400' />
            {t('female')} — {t('peopleCount', { count: stats.female })} (
            {stats.total > 0
              ? Math.round((stats.female / stats.total) * 100)
              : 0}
            %)
          </span>
        </div>
      </motion.div>

      {/* Grid for Zodiacs */}
      <div className='grid grid-cols-1 gap-8 md:grid-cols-2'>
        {/* Zodiac Breakdown */}
        {stats.zodiacBreakdown.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.8 }}
            className='card-feature'>
            <h2 className='mb-5 flex items-center gap-2 text-base font-semibold text-stone-700'>
              <Star className='size-4 text-purple-500' />
              {t('zodiacSigns')}
            </h2>
            <div className='space-y-3'>
              {stats.zodiacBreakdown.map(({ name, count }, i) => {
                const pct = stats.total > 0 ? (count / stats.total) * 100 : 0
                return (
                  <div key={name} className='flex items-center gap-3'>
                    <span className='w-24 shrink-0 text-sm font-medium text-stone-500'>
                      {name}
                    </span>
                    <div className='h-2 flex-1 overflow-hidden rounded-full bg-stone-100'>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{
                          duration: 0.6,
                          delay: 0.85 + i * 0.07,
                          ease: 'easeOut'
                        }}
                        className='h-full rounded-full bg-purple-400'
                      />
                    </div>
                    <span className='w-8 shrink-0 text-right text-sm font-medium text-stone-700'>
                      {count}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className='mt-4 text-sm text-stone-400 italic'>
              {t('zodiacSolarHint')}
            </p>
          </motion.div>
        )}

        {/* Chinese Zodiac Breakdown */}
        {stats.chineseZodiacBreakdown.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.95 }}
            className='card-feature'>
            <h2 className='mb-5 flex items-center gap-2 text-base font-semibold text-stone-700'>
              <Moon className='size-4 text-orange-500' />
              {t('chineseZodiac')}
            </h2>
            <div className='space-y-3'>
              {stats.chineseZodiacBreakdown.map(({ name, count }, i) => {
                const pct = stats.total > 0 ? (count / stats.total) * 100 : 0
                return (
                  <div key={name} className='flex items-center gap-3'>
                    <span className='w-24 shrink-0 text-sm font-medium text-stone-500'>
                      {name}
                    </span>
                    <div className='h-2 flex-1 overflow-hidden rounded-full bg-stone-100'>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{
                          duration: 0.6,
                          delay: 1 + i * 0.07,
                          ease: 'easeOut'
                        }}
                        className='h-full rounded-full bg-orange-400'
                      />
                    </div>
                    <span className='w-8 shrink-0 text-right text-sm font-medium text-stone-700'>
                      {count}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className='mt-4 text-sm text-stone-400 italic'>
              {t('chineseZodiacLunarHint')}
            </p>
          </motion.div>
        )}
      </div>
    </div>
  )
}
