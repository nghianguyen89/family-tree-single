'use client'

import { motion, Variants } from 'framer-motion'
import { ArrowRight, Network, ShieldCheck, Sparkles, Users } from 'lucide-react'
import Link from 'next/link'

import { useI18n } from '@/lib/i18n/I18nProvider'

const fadeIn: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }
  }
}

const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.15, delayChildren: 0.1 }
  }
}

interface LandingHeroProps {
  siteName: string
}

export default function LandingHero({ siteName }: LandingHeroProps) {
  const { t } = useI18n()
  const features = [
    {
      icon: <Users className='size-6 text-amber-700' />,
      title: t('featureMembers'),
      desc: t('featureMembersDescription')
    },
    {
      icon: <Network className='size-6 text-amber-700' />,
      title: t('featureTree'),
      desc: t('featureTreeDescription')
    },
    {
      icon: <ShieldCheck className='size-6 text-amber-700' />,
      title: t('featureSecurity'),
      desc: t('featureSecurityDescription')
    }
  ]

  return (
    <motion.div
      className='relative z-10 w-full max-w-5xl space-y-12 text-center'
      initial='hidden'
      animate='visible'
      variants={staggerContainer}>
      <motion.div
        className='flex flex-col items-center space-y-6 sm:space-y-8'
        variants={fadeIn}>
        <motion.div
          whileHover={{ scale: 1.05 }}
          className='group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full border border-amber-200/50 bg-surface/60 px-4 py-2 text-sm font-medium text-amber-800'>
          <Sparkles className='size-4 text-amber-500' />
          {t('landingBadge')}
          <div className='absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-surface/50 to-transparent transition-transform duration-1000 ease-in-out group-hover:translate-x-full'></div>
        </motion.div>

        <h1 className='max-w-4xl font-serif text-5xl leading-[1.1] font-semibold text-stone-900 sm:text-6xl md:text-7xl lg:text-[5rem]'>
          <span className='block'>{siteName}</span>
        </h1>

        <p className='mx-auto max-w-2xl text-sm leading-relaxed font-light text-stone-600'>
          {t('landingDescription')}
        </p>
      </motion.div>

      <motion.div
        className='relative flex w-full flex-col items-center justify-center gap-4 px-4 pt-6 sm:flex-row sm:px-0'
        variants={fadeIn}>
        <div className='absolute top-1/2 left-1/2 z-0 hidden h-16 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/30 blur-2xl sm:block'></div>
        <Link
          href='/login'
          className='group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl border border-stone-800 bg-primary px-8 py-4 text-sm font-medium text-surface transition-all duration-300 hover:-translate-y-1 hover:border-stone-700 hover:bg-stone-800 active:translate-y-0 sm:w-auto sm:px-10 sm:py-5'>
          <span className='relative z-10 flex items-center gap-3'>
            {t('landingCta')}
            <ArrowRight className='size-5 transition-transform group-hover:translate-x-1.5' />
          </span>
        </Link>
      </motion.div>

      <motion.div
        className='relative mt-24 grid grid-cols-1 gap-6 border-t border-stone-200/50 text-left sm:gap-8 md:grid-cols-3'
        variants={staggerContainer}>
        {features.map((feature) => (
          <motion.div
            key={feature.title}
            variants={fadeIn}
            whileHover={{ y: -5 }}
            className='card-feature group relative flex flex-col items-start overflow-hidden'>
            <div className='absolute top-0 right-0 h-32 w-32 rounded-bl-[100px] bg-linear-to-br from-amber-100/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100'></div>
            <div className='relative z-10 mb-6 rounded-2xl bg-surface p-3.5 shadow-sm ring-1 ring-stone-100 transition-all duration-300 group-hover:scale-110 group-hover:shadow-md'>
              {feature.icon}
            </div>
            <h2 className='relative z-10 mb-3 font-serif text-xl font-semibold text-stone-800 transition-colors group-hover:text-amber-900 sm:text-2xl'>
              {feature.title}
            </h2>
            <p className='relative z-10 text-sm leading-relaxed text-stone-600'>
              {feature.desc}
            </p>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  )
}
