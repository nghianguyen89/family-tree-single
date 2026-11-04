import assert from 'node:assert/strict'
import { test } from 'node:test'

import JSZip from 'jszip'
import Papa from 'papaparse'

import { validateImportPayload } from '../utils/backup-validation'
import { exportToCsvZip, parseCsvZip } from '../utils/csv'
import { exportToGedcom, parseGedcom } from '../utils/gedcom'

const ids = Array.from(
  { length: 7 },
  (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
)
const persons = [
  'Father',
  'First',
  'Second',
  'Child',
  'Single',
  'Adopted',
  'Other'
].map((full_name, i) => ({
  id: ids[i],
  full_name,
  gender: i === 1 || i === 2 ? 'female' : i === 6 ? 'other' : 'male',
  is_deceased: false,
  is_in_law: false
}))
const relation = (a: number, b: number, type = 'biological_child') => ({
  person_a: ids[a],
  person_b: ids[b],
  type
})

function restoredRelationships(relationships: ReturnType<typeof relation>[]) {
  const restored = parseGedcom(exportToGedcom({ persons, relationships }))
  const names = new Map(
    restored.persons.map((person) => [person.id, person.full_name])
  )
  return restored.relationships
    .map(
      (rel) =>
        `${names.get(rel.person_a)}:${rel.type}:${names.get(rel.person_b)}`
    )
    .sort()
}

test('GEDCOM uses actual parent links across multiple marriages and single parents', () => {
  const relationships = [
    relation(0, 1, 'marriage'),
    relation(0, 2, 'marriage'),
    relation(0, 3),
    relation(2, 3),
    relation(0, 4),
    relation(6, 5)
  ]
  assert.deepEqual(
    restoredRelationships(relationships),
    [
      'Father:marriage:First',
      'Father:marriage:Second',
      'Father:biological_child:Child',
      'Second:biological_child:Child',
      'Father:biological_child:Single',
      'Other:biological_child:Adopted'
    ].sort()
  )
})

test('GEDCOM keeps adoption, mixed pedigrees, unmarried parents and ordinary families', () => {
  const relationships = [
    relation(0, 1, 'marriage'),
    relation(0, 3),
    relation(1, 3),
    relation(0, 5, 'adopted_child'),
    relation(1, 5, 'adopted_child'),
    relation(0, 4),
    relation(2, 4, 'adopted_child'),
    relation(2, 6),
    relation(3, 6)
  ]
  const names = new Map(persons.map((person) => [person.id, person.full_name]))
  assert.deepEqual(
    restoredRelationships(relationships),
    relationships
      .map(
        (rel) =>
          `${names.get(rel.person_a)}:${rel.type}:${names.get(rel.person_b)}`
      )
      .sort()
  )
})

test('CSV restores phone numbers and numeric-looking text without losing typed fields', async () => {
  const data = {
    persons: [
      {
        ...persons[0],
        full_name: '12345',
        birth_year: 1980,
        memorial_is_leap_month: false,
        other_names: 'TRUE',
        note: '0123',
        created_at: '2026-10-29T12:00:00Z'
      },
      { ...persons[1], full_name: 'Partner', birth_year: null }
    ],
    relationships: [
      {
        id: ids[2],
        person_a: ids[0],
        person_b: ids[1],
        type: 'marriage' as const,
        note: 'TRUE'
      }
    ],
    person_details_private: [
      {
        person_id: ids[0],
        phone_number: '0123456789',
        occupation: '1234',
        current_residence: 'TRUE'
      }
    ],
    custom_events: [
      {
        id: ids[1],
        name: '1234',
        content: 'TRUE',
        event_date: '2026-10-29',
        location: '0123',
        created_by: null
      }
    ]
  }
  // The CSV API accepts partial Person fields; keep the fixture's gender literal.
  const restored = await parseCsvZip(
    await exportToCsvZip({
      ...data,
      persons: data.persons.map((person) => ({ ...person, gender: 'male' }))
    })
  )
  assert.equal(restored.persons[0].full_name, '12345')
  assert.equal(restored.persons[0].other_names, 'TRUE')
  assert.equal(restored.persons[0].note, '0123')
  assert.equal(restored.persons[0].created_at, '2026-10-29T12:00:00Z')
  assert.equal(restored.persons[0].birth_year, 1980)
  assert.equal(restored.persons[1].birth_year, null)
  assert.equal(restored.relationships[0].note, 'TRUE')
  assert.equal(restored.persons[0].is_deceased, false)
  assert.equal(restored.persons[0].memorial_is_leap_month, false)
  assert.deepEqual(restored.person_details_private, data.person_details_private)
  assert.equal(restored.custom_events?.[0].name, '1234')
  assert.equal(restored.custom_events?.[0].content, 'TRUE')
  assert.equal(restored.custom_events?.[0].created_by, null)
  assert.equal(
    validateImportPayload(restored, (key) => key),
    null
  )
})

test('CSV formula protection is reversible for signed phones, text and genuine apostrophes', async () => {
  const text = [
    '+84912345678',
    '-1234',
    '=SUM(1,2)',
    '@name',
    '\ttext',
    '\rtext',
    '=first\nsecond',
    "'+84912345678",
    "'original",
    "''original"
  ]
  const data = {
    persons: text.map((note, i) => ({
      id: `p${i}`,
      full_name: 'Person',
      note
    })),
    relationships: [
      {
        person_a: 'p0',
        person_b: 'p1',
        type: 'marriage' as const,
        note: '=1+1'
      }
    ],
    person_details_private: text.map((phone_number, i) => ({
      person_id: `p${i}`,
      phone_number,
      occupation: null,
      current_residence: null
    })),
    custom_events: [
      {
        id: 'event',
        name: '@event',
        content: "'original",
        event_date: '2026-10-29',
        location: '-place',
        created_by: null
      }
    ]
  }
  const archive = await exportToCsvZip(data)
  const zip = await new JSZip().loadAsync(archive)
  for (const [filename, field] of [
    ['persons.csv', 'note'],
    ['person_details_private.csv', 'phone_number']
  ]) {
    const raw = Papa.parse<Record<string, string>>(
      await zip.file(filename)!.async('text'),
      { header: true }
    ).data
    text.forEach((value, i) => {
      // Spreadsheet-facing files always have an apostrophe before dangerous cells.
      assert.equal(raw[i][field], "'" + value)
    })
  }
  const restored = await parseCsvZip(archive)
  assert.deepEqual(
    restored.persons.map((person) => person.note),
    text
  )
  assert.deepEqual(restored.person_details_private, data.person_details_private)
  assert.deepEqual(restored.custom_events, data.custom_events)
  assert.equal(restored.relationships[0].note, '=1+1')
})

test('external legacy CSV archives retain literal leading apostrophes', async () => {
  const zip = new JSZip()
  const notes = ["'+84912345678", "'original", "''original", '+84912345678']
  zip.file(
    'persons.csv',
    Papa.unparse(notes.map((note, i) => ({ id: `p${i}`, note })))
  )
  zip.file('relationships.csv', 'person_a,person_b,type\r\np0,p1,marriage')
  const restored = await parseCsvZip(await zip.generateAsync({ type: 'blob' }))
  assert.deepEqual(
    restored.persons.map((person) => person.note),
    notes
  )
  zip.file(
    'giapha-csv.json',
    JSON.stringify({ version: 999, textEncoding: 'unknown' })
  )
  await assert.rejects(
    parseCsvZip(await zip.generateAsync({ type: 'blob' })),
    /CSV/
  )
})
