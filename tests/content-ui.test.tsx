import assert from 'node:assert/strict'
import { test } from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import ContentBody from '../components/content/ContentBody'
import HomeSettingsEditor from '../components/content/HomeSettingsEditor'
import MediaManager from '../components/content/MediaManager'
import { I18nProvider } from '../lib/i18n/I18nProvider'
import type { ContentInput } from '../types/content'

test('public editorial body escapes supplied markup and uses the authorized image proxy', () => {
  const entry: ContentInput = {
    kind: 'album',
    title: '<script>alert(1)</script>',
    summary: 'Summary',
    body: '<img src=x onerror=alert(1)>',
    category: 'news',
    status: 'published',
    visibility: 'internal',
    is_featured: false,
    publish_at: '2026-10-15T00:00:00Z',
    expires_at: null,
    event_start: null,
    event_end: null,
    location: ''
  }
  const html = renderToStaticMarkup(
    <ContentBody
      entry={entry}
      images={[
        {
          id: '33333333-3333-4333-8333-333333333333',
          entry_id: null,
          storage_path: 'private.png',
          alt: 'Family photo',
          caption: 'A moment',
          position: 0
        }
      ]}
      locale='vi'
    />
  )
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<img src=x/)
  assert.match(html, /Nội bộ/)
  assert.match(html, /\/api\/content\/image\?id=/)
  assert.doesNotMatch(html, /private\.png/)
})

test('homepage settings and image details use distinct save labels', () => {
  const html = renderToStaticMarkup(
    <I18nProvider initialLocale='vi'>
      <HomeSettingsEditor
        initial={{
          id: 1,
          title: 'Family homepage',
          subtitle: '',
          origin: 'Xã mới\nTỉnh mới',
          origin_previous: 'Xã cũ\nHuyện cũ, tỉnh cũ',
          introduction: '',
          contact: '',
          cover_image_id: null,
          section_order: ['announcements', 'articles', 'albums'],
          revision: 1
        }}
        images={[
          {
            id: '33333333-3333-4333-8333-333333333333',
            entry_id: null,
            storage_path: 'photo.png',
            alt: 'A photo',
            caption: '',
            position: 0
          }
        ]}
      />
    </I18nProvider>
  )
  assert.match(html, /Lưu thông tin và ảnh bìa/)
  assert.match(html, /Lưu mô tả ảnh/)
  assert.doesNotMatch(html, />Lưu thay đổi</)
  assert.match(html, /Không dùng ảnh bìa/)
  assert.match(html, /Địa chỉ hiện nay/)
  assert.match(html, /Địa chỉ cũ \(trước sáp nhập\)/)
  assert.match(html, /<textarea[^>]*>Xã mới\nTỉnh mới<\/textarea>/)
  assert.match(html, /<textarea[^>]*>Xã cũ\nHuyện cũ, tỉnh cũ<\/textarea>/)
})

test('a pending cover has an explicit save button bound to the homepage settings form outside image metadata forms', () => {
  const id = '33333333-3333-4333-8333-333333333333'
  const html = renderToStaticMarkup(
    <I18nProvider initialLocale='vi'>
      <MediaManager
        entryId={null}
        initialImages={[
          {
            id,
            entry_id: null,
            storage_path: 'photo.png',
            alt: 'A photo',
            caption: '',
            position: 0
          }
        ]}
        selectedId={id}
        protectedId={null}
        onSelect={() => {}}
        selectionFormId='homepage-settings-test'
        selectionPending
      />
    </I18nProvider>
  )
  assert.match(html, /Đã chọn ảnh này, chưa lưu lên trang chủ/)
  assert.match(
    html,
    /<button type="submit" form="homepage-settings-test"[^>]*>Lưu ảnh bìa trang chủ<\/button>/
  )
  const settingsSave = html.indexOf('form="homepage-settings-test"'),
    metadataForm = html.indexOf('<form', html.indexOf('Đã chọn ảnh này'))
  assert.ok(settingsSave > 0 && metadataForm > settingsSave)
})
