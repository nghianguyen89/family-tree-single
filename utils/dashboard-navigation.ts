import type { Profile } from '@/types'
import { SHARED_VIEWER_PATHS } from '@/utils/shared-viewer'

type Access = 'public' | 'member' | 'editor' | 'admin'
export type NavigationKey =
  | 'overview'
  | 'members'
  | 'kinship'
  | 'events'
  | 'gallery'
  | 'statistics'
  | 'newMember'
  | 'content'
  | 'settings'
  | 'intake'
  | 'users'
  | 'lineage'
  | 'data'
  | 'upgrade'
  | 'home'
  | 'news'
  | 'about'

export interface NavigationItem {
  key: NavigationKey
  href: string
}
interface NavigationGroup {
  key: 'family' | 'editorial' | 'administration' | 'website'
  access: Access
  items: NavigationItem[]
}
const groups: NavigationGroup[] = [
  {
    key: 'family',
    access: 'member',
    items: [
      { key: 'overview', href: '/dashboard' },
      { key: 'members', href: '/dashboard/members' },
      { key: 'kinship', href: '/dashboard/kinship' },
      { key: 'events', href: '/dashboard/events' },
      { key: 'gallery', href: '/dashboard/gallery' },
      { key: 'statistics', href: '/dashboard/stats' }
    ]
  },
  {
    key: 'editorial',
    access: 'editor',
    items: [
      { key: 'newMember', href: '/dashboard/members/new' },
      { key: 'intake', href: '/dashboard/intake' },
      { key: 'content', href: '/dashboard/content' },
      { key: 'settings', href: '/dashboard/content/settings' }
    ]
  },
  {
    key: 'administration',
    access: 'admin',
    items: [
      { key: 'users', href: '/dashboard/users' },
      { key: 'lineage', href: '/dashboard/lineage' },
      { key: 'data', href: '/dashboard/data' },
      { key: 'upgrade', href: '/dashboard/upgrade' }
    ]
  },
  {
    key: 'website',
    access: 'public',
    items: [
      { key: 'home', href: '/' },
      { key: 'news', href: '/news' },
      { key: 'about', href: '/about' }
    ]
  }
]

export function getDashboardNavigation(
  profile: Pick<Profile, 'role' | 'is_active' | 'is_shared_viewer'> | null
) {
  const active = profile?.is_active === true
  if (profile?.is_shared_viewer) {
    return active
      ? groups
          .filter((group) => group.key === 'family')
          .map((group) => ({
            ...group,
            items: group.items.filter((item) =>
              SHARED_VIEWER_PATHS.includes(item.href)
            )
          }))
      : []
  }
  const admin = active && profile?.role === 'admin'
  const editor = active && (admin || profile?.role === 'editor')
  return groups.filter(
    (group) =>
      group.access === 'public' ||
      (group.access === 'member' && active) ||
      (group.access === 'editor' && editor) ||
      (group.access === 'admin' && admin)
  )
}

export function activeNavigationHref(
  pathname: string,
  items: NavigationItem[]
) {
  return items
    .filter(
      ({ href }) =>
        pathname === href ||
        (href !== '/' &&
          href !== '/dashboard' &&
          pathname.startsWith(`${href}/`))
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href
}
