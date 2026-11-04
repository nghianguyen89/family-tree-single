'use client'

import {
  ArrowUpCircle,
  BarChart2,
  CalendarDays,
  ClipboardList,
  Database,
  FileText,
  GitMerge,
  Home,
  Image,
  Info,
  LayoutDashboard,
  ListTree,
  Menu,
  Network,
  Newspaper,
  Settings2,
  UserPlus,
  Users,
  X
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'

import LogoutButton from '@/components/LogoutButton'
import { useUser } from '@/components/UserProvider'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { navigationMessages } from '@/lib/i18n/navigation'
import { sharedViewerMessages } from '@/lib/i18n/shared-viewer'
import {
  activeNavigationHref,
  getDashboardNavigation
} from '@/utils/dashboard-navigation'

const icons = {
  overview: LayoutDashboard,
  members: Network,
  kinship: GitMerge,
  events: CalendarDays,
  gallery: Image,
  statistics: BarChart2,
  newMember: UserPlus,
  intake: ClipboardList,
  content: FileText,
  settings: Settings2,
  users: Users,
  lineage: ListTree,
  data: Database,
  upgrade: ArrowUpCircle,
  home: Home,
  news: Newspaper,
  about: Info
}

const MobileMenuContext = createContext<{
  expanded: boolean
  toggle: () => void
} | null>(null)

export function MobileDashboardMenuButton() {
  const menu = useContext(MobileMenuContext)
  const { locale } = useI18n()
  if (!menu) return null
  const text = navigationMessages[locale]
  return (
    <button
      id='dashboard-mobile-menu-trigger'
      type='button'
      aria-expanded={menu.expanded}
      aria-controls='dashboard-navigation'
      aria-label={text.expand}
      title={text.expand}
      onClick={menu.toggle}
      className='inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-secondary hover:bg-neutral hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary md:hidden'>
      <Menu className='size-5' aria-hidden='true' />
    </button>
  )
}

export default function DashboardShell({
  header,
  footer,
  children
}: {
  header: ReactNode
  footer: ReactNode
  children: ReactNode
}) {
  const { profile, user } = useUser()
  const { locale } = useI18n()
  const text = navigationMessages[locale]
  const pathname = usePathname()
  const [expanded, setExpanded] = useState(false)
  const [mobile, setMobile] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const groups = getDashboardNavigation(profile)
  const activeHref = activeNavigationHref(
    pathname,
    groups.flatMap((group) => group.items)
  )

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const sync = () => setMobile(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!expanded) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false)
        if (!mobile) toggleRef.current?.focus()
      }
      if (mobile && event.key === 'Tab') {
        const elements = panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled)'
        )
        if (!elements?.length) return
        const first = elements[0],
          last = elements[elements.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKey)
    if (mobile) {
      const previousOverflow = document.body.style.overflow
      const trigger = document.getElementById('dashboard-mobile-menu-trigger')
      document.body.style.overflow = 'hidden'
      toggleRef.current?.focus()
      return () => {
        document.body.style.overflow = previousOverflow
        document.removeEventListener('keydown', handleKey)
        trigger?.focus()
      }
    }
    return () => document.removeEventListener('keydown', handleKey)
  }, [expanded, mobile])

  return (
    <div className='min-h-dvh bg-neutral font-sans text-sm text-primary'>
      <a
        href='#dashboard-content'
        className='sr-only z-50 rounded-xl bg-primary p-3 text-surface focus:not-sr-only focus:fixed focus:top-2 focus:left-2'>
        {text.skip}
      </a>
      {expanded && (
        <button
          type='button'
          tabIndex={-1}
          onClick={() => setExpanded(false)}
          aria-label={text.close}
          className='fixed inset-0 z-30 bg-primary/40 md:hidden'
        />
      )}
      <aside
        ref={panelRef}
        role={mobile && expanded ? 'dialog' : undefined}
        aria-modal={mobile && expanded ? true : undefined}
        aria-label={text.navigation}
        data-expanded={expanded}
        className={`fixed inset-y-0 left-0 z-40 flex-col border-r border-border bg-surface ${expanded ? 'flex w-64' : 'hidden w-16 md:flex'}`}>
        <div className='flex h-16 shrink-0 items-center gap-3 border-b border-border px-2'>
          <button
            ref={toggleRef}
            type='button'
            aria-expanded={expanded}
            aria-controls='dashboard-navigation'
            aria-label={expanded ? text.collapse : text.expand}
            title={expanded ? text.collapse : text.expand}
            onClick={() => setExpanded((value) => !value)}
            className='flex size-12 shrink-0 items-center justify-center rounded-xl text-secondary hover:bg-neutral hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary'>
            {expanded ? (
              <X className='size-5' aria-hidden='true' />
            ) : (
              <Menu className='size-5' aria-hidden='true' />
            )}
          </button>
          {expanded && <span className='font-medium'>{text.navigation}</span>}
        </div>
        <nav
          id='dashboard-navigation'
          aria-label={text.navigation}
          className={`min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-2 py-3 ${expanded ? '' : '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'}`}>
          {groups.map((group) => (
            <div key={group.key} className='space-y-1'>
              {expanded ? (
                <p className='px-3 py-2 font-medium text-secondary'>
                  {text[group.key]}
                </p>
              ) : (
                <div className='mx-3 border-t border-border first:border-0' />
              )}
              {group.items.map(({ key, href }) => {
                const Icon = icons[key]
                const active = activeHref === href
                return (
                  <Link
                    key={href}
                    href={href}
                    title={expanded ? undefined : text[key]}
                    aria-label={expanded ? undefined : text[key]}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => {
                      if (mobile) setExpanded(false)
                    }}
                    className={`flex min-h-12 items-center gap-3 rounded-xl py-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary ${expanded ? 'px-3' : 'justify-center'} ${active ? 'bg-primary text-surface' : 'text-secondary hover:bg-neutral hover:text-primary'}`}>
                    <Icon className='size-5 shrink-0' aria-hidden='true' />
                    <span className={expanded ? '' : 'sr-only'}>
                      {text[key]}
                    </span>
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
        <div className='shrink-0 space-y-2 border-t border-border p-2'>
          {expanded && (
            <div className='min-w-0 px-3 py-2'>
              <p className='truncate font-medium' title={user?.email}>
                {profile?.is_shared_viewer
                  ? sharedViewerMessages[locale].title
                  : user?.email}
              </p>
              {profile && (
                <p className='mt-1 text-secondary'>
                  {profile.is_shared_viewer
                    ? sharedViewerMessages[locale].readOnly
                    : text[profile.role]}
                </p>
              )}
            </div>
          )}
          <LogoutButton
            compact={!expanded}
            localOnly={profile?.is_shared_viewer === true}
          />
        </div>
      </aside>
      <div
        inert={mobile && expanded}
        className={`flex min-h-dvh min-w-0 flex-col ${expanded ? 'md:pl-64' : 'md:pl-16'}`}>
        <MobileMenuContext.Provider
          value={{
            expanded,
            toggle: () => setExpanded((value) => !value)
          }}>
          {header}
        </MobileMenuContext.Provider>
        <div
          id='dashboard-content'
          tabIndex={-1}
          className='flex min-w-0 flex-1 flex-col outline-none'>
          {children}
        </div>
        {footer}
      </div>
    </div>
  )
}
