export const SHARED_VIEWER_PATHS = [
  '/dashboard',
  '/dashboard/members',
  '/dashboard/events',
  '/dashboard/gallery',
  '/dashboard/stats'
]

export function isSharedViewerPath(pathname: string) {
  return (
    SHARED_VIEWER_PATHS.includes(pathname) ||
    /^\/dashboard\/members\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      pathname
    )
  )
}

export function validSharedPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{8}$/.test(pin)
}
