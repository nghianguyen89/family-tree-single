import Link from 'next/link'

import ContentListActions from '@/components/content/ContentListActions'
import { contentText } from '@/lib/i18n/content'
import { getServerLocale } from '@/lib/i18n/server'
import type { ContentEntry, ContentKind } from '@/types/content'
import { CONTENT_KINDS, formatContentDate } from '@/utils/content'
import { requireContentEditor } from '@/utils/supabase/content-editor'
import { getSupabase } from '@/utils/supabase/queries'

export default async function ContentManagerPage({
  searchParams
}: {
  searchParams: Promise<{
    kind?: string
    status?: string
    page?: string
    trash?: string
    q?: string
  }>
}) {
  await requireContentEditor()
  const params = await searchParams,
    t = contentText(await getServerLocale()),
    locale = await getServerLocale()
  const trash = params.trash === '1',
    page = Math.min(10000, Math.max(0, Number(params.page) || 0)) | 0
  const now = new Date().getTime()
  const kind = CONTENT_KINDS.includes(params.kind as ContentKind)
    ? params.kind
    : ''
  const status = ['draft', 'published'].includes(params.status || '')
    ? params.status
    : ''
  const q = typeof params.q === 'string' ? params.q.slice(0, 100) : ''
  const db = await getSupabase()
  let query = db
    .from('home_content')
    .select('*', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .order('id')
    .range(page * 20, page * 20 + 19)
  query = trash
    ? query.not('deleted_at', 'is', null)
    : query.is('deleted_at', null)
  if (kind) query = query.eq('kind', kind)
  if (status) query = query.eq('status', status)
  if (q) query = query.ilike('title', `%${q.replace(/[\\%_]/g, '\\$&')}%`)
  const { data, count, error } = await query
  const rows = (data || []) as ContentEntry[]
  const href = (p: number) =>
    '/dashboard/content?' +
    new URLSearchParams({
      page: String(p),
      ...(trash ? { trash: '1' } : {}),
      ...(kind ? { kind } : {}),
      ...(status ? { status } : {}),
      ...(q ? { q } : {})
    }).toString()
  return (
    <div className='space-y-6'>
      {trash && <p className='text-sm text-secondary'>{t.trashHelp}</p>}
      <form className='grid items-end gap-4 rounded-xl border border-border bg-surface p-6 sm:grid-cols-2 lg:grid-cols-4'>
        {trash && <input type='hidden' name='trash' value='1' />}
        <label className='content-field'>
          {t.search}
          <input
            className='content-control'
            name='q'
            maxLength={100}
            defaultValue={q}
          />
        </label>
        <label className='content-field'>
          {t.kind}
          <select className='content-control' name='kind' defaultValue={kind}>
            <option value=''>{t.every}</option>
            {CONTENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t[k]}
              </option>
            ))}
          </select>
        </label>
        <label className='content-field'>
          {t.status}
          <select
            className='content-control'
            name='status'
            defaultValue={status}>
            <option value=''>{t.every}</option>
            <option value='draft'>{t.draft}</option>
            <option value='published'>{t.published}</option>
          </select>
        </label>
        <button className='btn-outline' type='submit'>
          {t.filter}
        </button>
      </form>
      {error ? (
        <p
          role='alert'
          className='rounded-xl border border-border bg-surface p-6 text-secondary'>
          {t.migration}
        </p>
      ) : !rows.length ? (
        <p className='text-secondary'>{t.noResults}</p>
      ) : (
        <div className='space-y-4'>
          {rows.map((entry) => (
            <article
              key={`${entry.id}-${entry.revision}`}
              className='flex flex-wrap items-center justify-between gap-6 rounded-xl border border-border bg-surface p-6'>
              <div className='min-w-0 flex-1 space-y-2'>
                <div className='flex flex-wrap gap-3 text-sm text-secondary'>
                  <span>{t[entry.kind]}</span>
                  <span>{t[entry.visibility]}</span>
                  <span>
                    {entry.status === 'draft'
                      ? t.draft
                      : entry.expires_at && Date.parse(entry.expires_at) <= now
                        ? t.expired
                        : entry.publish_at && Date.parse(entry.publish_at) > now
                          ? t.scheduled
                          : t.published}
                  </span>
                  {entry.is_featured && (
                    <span className='text-tertiary'>{t.pinned}</span>
                  )}
                </div>
                <h2 className='font-serif text-xl font-semibold break-words'>
                  {entry.deleted_at ? (
                    entry.title
                  ) : (
                    <Link
                      href={`/dashboard/content/${entry.id}`}
                      className='hover:text-tertiary'>
                      {entry.title}
                    </Link>
                  )}
                </h2>
                <p className='text-sm text-secondary'>
                  {t.updated}:{' '}
                  {formatContentDate(entry.updated_at, locale, true)}
                </p>
              </div>
              <ContentListActions entry={entry} locale={locale} />
            </article>
          ))}
        </div>
      )}
      <nav className='flex justify-between gap-3' aria-label={t.contents}>
        {page > 0 ? (
          <Link className='btn-outline' href={href(page - 1)}>
            {t.previous}
          </Link>
        ) : (
          <span />
        )}
        {(page + 1) * 20 < (count || 0) && (
          <Link className='btn-outline' href={href(page + 1)}>
            {t.next}
          </Link>
        )}
      </nav>
    </div>
  )
}
