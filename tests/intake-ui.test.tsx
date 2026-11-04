import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { renderToStaticMarkup } from 'react-dom/server'

import IntakeManager from '../components/intake/IntakeManager'
import PersonFields from '../components/intake/PersonFields'
import PublicIntakeForm from '../components/intake/PublicIntakeForm'
import { I18nProvider } from '../lib/i18n/I18nProvider'
import type { Person } from '../types'

test('intake list offers copying after reload, legacy replacement and deletion while hiding copy on closed links', () => {
  const html = renderToStaticMarkup(
    <AppRouterContext.Provider
      value={{
        bfcacheId: 'intake-test',
        back() {},
        forward() {},
        refresh() {},
        push() {},
        replace() {},
        prefetch() {}
      }}>
      <I18nProvider initialLocale='vi'>
        <IntakeManager
          people={[
            { id: 'root', full_name: 'Ancestor', generation: 1 } as Person
          ]}
          links={[
            {
              id: 'active',
              title: 'Active',
              root_person_id: 'root',
              is_active: true,
              share_token: 'a'.repeat(64),
              expires_at: '2099-01-01T00:00:00Z',
              created_at: '2026-01-01T00:00:00Z'
            },
            {
              id: 'legacy',
              title: 'Legacy',
              root_person_id: 'root',
              is_active: true,
              share_token: null,
              expires_at: '2099-01-01T00:00:00Z',
              created_at: '2026-01-01T00:00:00Z'
            },
            {
              id: 'closed',
              title: 'Closed',
              root_person_id: 'root',
              is_active: false,
              share_token: 'b'.repeat(64),
              expires_at: '2099-01-01T00:00:00Z',
              created_at: '2026-01-01T00:00:00Z'
            },
            {
              id: 'expired',
              title: 'Expired',
              root_person_id: 'root',
              is_active: true,
              share_token: 'c'.repeat(64),
              expires_at: '2020-01-01T00:00:00Z',
              created_at: '2020-01-01T00:00:00Z'
            }
          ]}
        />
      </I18nProvider>
    </AppRouterContext.Provider>
  )
  assert.equal((html.match(/>Sao chép link<\/button>/g) || []).length, 1)
  assert.equal((html.match(/>Tạo link thay thế<\/button>/g) || []).length, 1)
  assert.equal((html.match(/>Xóa link<\/button>/g) || []).length, 4)
})

test('public family form renders a branch/generation selector without a login or private profile fields', () => {
  const html = renderToStaticMarkup(
    <I18nProvider initialLocale='vi'>
      <PublicIntakeForm
        token={'a'.repeat(64)}
        options={{
          title: 'Shared branch',
          root_id: '44444444-4444-4444-8444-444444444444',
          people: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              full_name: 'Ancestor',
              generation: 1
            }
          ]
        }}
      />
    </I18nProvider>
  )
  assert.match(html, /Shared branch/)
  assert.match(html, /Ancestor/)
  assert.match(html, /Tất cả các đời/)
  assert.doesNotMatch(html, /type="password"/)
  assert.doesNotMatch(html, /value="1900"/)
})
test('a deceased person with no death date can enter an independent yearless memorial', () => {
  const html = renderToStaticMarkup(
    <I18nProvider initialLocale='vi'>
      <PersonFields
        value={{
          full_name: 'Ancestor',
          gender: 'male',
          is_deceased: true,
          memorial_calendar: 'lunar',
          memorial_day: 5,
          memorial_month: 3,
          memorial_is_leap_month: false
        }}
        onChange={() => {}}
      />
    </I18nProvider>
  )
  assert.match(html, /Thiết lập ngày cúng riêng hằng năm/)
  assert.match(html, /Không cần biết ngày hay năm mất/)
  assert.match(html, /Tháng nhuận âm lịch/)
  assert.match(html, /value="5"/)
  assert.doesNotMatch(html, /value="1900"/)
})
