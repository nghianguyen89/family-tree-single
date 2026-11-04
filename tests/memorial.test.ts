import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Solar } from 'lunar-javascript'

import { exportToCsvZip, parseCsvZip } from '../utils/csv'
import { computeEvents } from '../utils/eventHelpers'
import { exportToGedcom, parseGedcom } from '../utils/gedcom'
import { isValidMemorial } from '../utils/memorial'

const ancestor = {
  id: '33333333-3333-4333-8333-333333333333',
  full_name: 'Ancestor',
  gender: 'male' as const,
  is_deceased: true,
  birth_year: null,
  birth_month: null,
  birth_day: null,
  death_year: null,
  death_month: null,
  death_day: null,
  death_lunar_year: null,
  death_lunar_month: null,
  death_lunar_day: null,
  memorial_calendar: 'solar' as const,
  memorial_day: 15,
  memorial_month: 2,
  memorial_is_leap_month: false,
  memorial_note: 'Family custom\nNo death date known'
}

test('yearless memorial generates an annual event and overrides a known death date', () => {
  const events = computeEvents(
    [{ ...ancestor, death_year: 1938, death_month: 3, death_day: 6 }],
    [],
    new Date(2026, 0, 1)
  )
  assert.equal(events.length, 1)
  assert.equal(events[0].nextOccurrence.getMonth(), 1)
  assert.equal(events[0].nextOccurrence.getDate(), 15)
  assert.equal(events[0].originYear, null)
  assert.equal(events[0].isMemorial, true)
  assert.equal(events[0].content, ancestor.memorial_note)
})
test('Gregorian February 29 skips non-leap years instead of moving to March', () => {
  const events = computeEvents(
    [{ ...ancestor, memorial_day: 29 }],
    [],
    new Date(2026, 0, 1)
  )
  assert.equal(events[0].nextOccurrence.getFullYear(), 2028)
  assert.equal(events[0].nextOccurrence.getMonth(), 1)
  assert.equal(events[0].nextOccurrence.getDate(), 29)
})
test('lunar leap-month memorial only occurs in the requested leap month', () => {
  const events = computeEvents(
    [
      {
        ...ancestor,
        memorial_calendar: 'lunar',
        memorial_is_leap_month: true,
        memorial_month: 2,
        memorial_day: 5
      }
    ],
    [],
    new Date(2024, 0, 1)
  )
  assert.ok(events.length > 0)
  const lunar = Solar.fromDate(events[0].nextOccurrence).getLunar()
  assert.equal(lunar.getMonth(), -2)
  assert.equal(lunar.getDay(), 5)
  assert.match(events[0].eventDateLabel, /nhuận/)
})
test('partial solar death dates do not fabricate a lunar anniversary with the current year', () => {
  const {
    memorial_calendar,
    memorial_day,
    memorial_month,
    memorial_note,
    memorial_is_leap_month,
    ...person
  } = ancestor
  void memorial_calendar
  void memorial_day
  void memorial_month
  void memorial_note
  void memorial_is_leap_month
  assert.deepEqual(
    computeEvents(
      [{ ...person, death_day: 10, death_month: 3 }],
      [],
      new Date(2026, 0, 1)
    ),
    []
  )
})
test('memorial validation rejects incomplete or impossible dates and living profiles', () => {
  assert.equal(isValidMemorial(ancestor), true)
  for (const patch of [
    { is_deceased: false },
    { memorial_day: null },
    { memorial_month: 13 },
    { memorial_day: 31, memorial_month: 4 },
    { memorial_is_leap_month: true },
    { memorial_calendar: null }
  ])
    assert.equal(isValidMemorial({ ...ancestor, ...patch }), false)
})
test('CSV and application GEDCOM extensions preserve yearless memorials and multiline notes', async () => {
  const data = {
    persons: [ancestor],
    relationships: [
      {
        type: 'marriage' as const,
        person_a: ancestor.id,
        person_b: '44444444-4444-4444-8444-444444444444'
      }
    ]
  }
  const restored = parseGedcom(exportToGedcom(data)).persons[0]
  for (const field of [
    'memorial_day',
    'memorial_month',
    'memorial_calendar',
    'memorial_is_leap_month',
    'memorial_note'
  ] as const)
    assert.equal(restored[field], ancestor[field])
  const csv = await parseCsvZip(await exportToCsvZip(data))
  assert.equal(csv.persons[0].memorial_day, 15)
  assert.equal(csv.persons[0].memorial_note, ancestor.memorial_note)
})
