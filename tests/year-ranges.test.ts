import assert from 'node:assert/strict'
import { test } from 'node:test'

import { exportToCsvZip, parseCsvZip } from '../utils/csv'
import { calculateAge, formatDisplayDate } from '../utils/dateHelpers'
import { computeEvents } from '../utils/eventHelpers'
import { exportToGedcom, parseGedcom } from '../utils/gedcom'
import { hasValidPersonYearRanges } from '../utils/yearRanges'

const person = {
  id: '33333333-3333-4333-8333-333333333333',
  full_name: 'Ancestor',
  gender: 'male' as const,
  birth_year: null,
  birth_month: null,
  birth_day: null,
  death_year: null,
  death_month: null,
  death_day: null,
  death_lunar_year: null,
  death_lunar_month: null,
  death_lunar_day: null,
  birth_year_from: 1880,
  birth_year_to: 1885,
  death_year_from: 1937,
  death_year_to: 1939,
  is_deceased: true
}

test('GEDCOM and CSV preserve estimated years without inventing exact dates', async () => {
  const partnerId = '44444444-4444-4444-8444-444444444444'
  const data = {
    persons: [person, { ...person, id: partnerId }],
    relationships: [
      { person_a: person.id, person_b: partnerId, type: 'marriage' as const }
    ]
  }
  const gedcom = exportToGedcom(data)
  assert.match(gedcom, /2 DATE BET 1880 AND 1885/)
  assert.match(gedcom, /2 DATE BET 1937 AND 1939/)
  const restored = parseGedcom(gedcom).persons[0]
  for (const field of [
    'birth_year_from',
    'birth_year_to',
    'death_year_from',
    'death_year_to',
    'birth_year',
    'death_year'
  ] as const) {
    assert.equal(restored[field], person[field])
  }
  const csv = await parseCsvZip(await exportToCsvZip(data))
  assert.equal(csv.persons[0].birth_year_from, 1880)
  assert.equal(csv.persons[0].death_year_to, 1939)
})

test('estimated dates display as ranges, never exact ages or anniversaries', () => {
  assert.equal(formatDisplayDate(null, null, null, 1880, 1885), '≈ 1880–1885')
  assert.equal(formatDisplayDate(1880, null, null), '1880')
  assert.equal(calculateAge(null, null, null, null, null, null, true), null)
  assert.deepEqual(computeEvents([person]), [])
  assert.equal(hasValidPersonYearRanges(person), true)
  for (const change of [
    { birth_year_from: 1886 },
    { birth_year_to: null },
    { birth_year: 1880 },
    { birth_year_from: 0 },
    { death_year_to: 10000 },
    { death_lunar_day: 1 },
    { is_deceased: false },
    { death_year_from: 1870, death_year_to: 1875 }
  ]) {
    assert.equal(hasValidPersonYearRanges({ ...person, ...change }), false)
  }
})
