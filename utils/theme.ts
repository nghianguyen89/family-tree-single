export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'giapha-theme'

export function resolveTheme(
  saved: string | null,
  prefersDark: boolean
): Theme {
  return saved === 'light' || saved === 'dark'
    ? saved
    : prefersDark
      ? 'dark'
      : 'light'
}

// Runs in <head> before paint. Keep storage failures separate from system fallback.
export const themeInitScript = `(() => {
  let saved = null;
  try { saved = localStorage.getItem('${THEME_STORAGE_KEY}'); } catch {}
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = (${resolveTheme.toString()})(saved, prefersDark);
})();`
