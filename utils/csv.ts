import JSZip from 'jszip'
import Papa from 'papaparse'

import { Person, Relationship } from '@/types'

const UTF8_BOM = '\uFEFF'
const csvFormat = { version: 1, textEncoding: 'apostrophe-prefix-v1' }
const formulaPrefix = /^[=+\-@\t\r]/

function encodeCsvRows(rows: object[]) {
  // Double genuine apostrophes so they remain distinguishable from formula escaping.
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === 'string' && value.startsWith("'") ? "'" + value : value
      ])
    )
  )
}

const typedPersonFields = new Set([
  'birth_year',
  'birth_month',
  'birth_day',
  'birth_year_from',
  'birth_year_to',
  'death_year',
  'death_month',
  'death_day',
  'death_year_from',
  'death_year_to',
  'death_lunar_year',
  'death_lunar_month',
  'death_lunar_day',
  'memorial_day',
  'memorial_month',
  'memorial_is_leap_month',
  'is_deceased',
  'is_in_law',
  'birth_order',
  'generation'
])

interface PersonDetailsPrivateRow {
  person_id: string
  phone_number: string | null
  occupation: string | null
  current_residence: string | null
}

interface CustomEventRow {
  id: string
  name: string
  content: string | null
  event_date: string
  location: string | null
  created_by: string | null
}

export async function exportToCsvZip(data: {
  persons: Partial<Person>[]
  relationships: Partial<Relationship>[]
  person_details_private?: PersonDetailsPrivateRow[]
  custom_events?: CustomEventRow[]
}): Promise<Blob> {
  const personsCsv =
    UTF8_BOM +
    Papa.unparse(encodeCsvRows(data.persons), { escapeFormulae: formulaPrefix })
  const relationshipsCsv =
    UTF8_BOM +
    Papa.unparse(encodeCsvRows(data.relationships), {
      escapeFormulae: formulaPrefix
    })

  const zip = new JSZip()
  zip.file('giapha-csv.json', JSON.stringify(csvFormat))
  zip.file('persons.csv', personsCsv)
  zip.file('relationships.csv', relationshipsCsv)

  if (data.person_details_private && data.person_details_private.length > 0) {
    zip.file(
      'person_details_private.csv',
      UTF8_BOM +
        Papa.unparse(encodeCsvRows(data.person_details_private), {
          escapeFormulae: formulaPrefix
        })
    )
  }

  if (data.custom_events && data.custom_events.length > 0) {
    zip.file(
      'custom_events.csv',
      UTF8_BOM +
        Papa.unparse(encodeCsvRows(data.custom_events), {
          escapeFormulae: formulaPrefix
        })
    )
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  return zipBlob
}

export async function parseCsvZip(zipBlob: Blob): Promise<{
  persons: Partial<Person>[]
  relationships: Partial<Relationship>[]
  person_details_private?: PersonDetailsPrivateRow[]
  custom_events?: CustomEventRow[]
}> {
  const zip = new JSZip()
  const loadedZip = await zip.loadAsync(zipBlob)
  const formatFile = loadedZip.file('giapha-csv.json')
  if (formatFile) {
    const format = JSON.parse(await formatFile.async('text'))
    if (
      format?.version !== csvFormat.version ||
      format?.textEncoding !== csvFormat.textEncoding
    )
      throw new Error('Định dạng mã hóa CSV không được hỗ trợ.')
  }
  const nullableCsvValue = (value: string) => {
    if (
      formatFile &&
      value.startsWith("'") &&
      (value.startsWith("''") || formulaPrefix.test(value.slice(1)))
    )
      value = value.slice(1)
    return value === '' ? null : value
  }

  const personsFile = loadedZip.file('persons.csv')
  const relationshipsFile = loadedZip.file('relationships.csv')

  if (!personsFile || !relationshipsFile) {
    throw new Error(
      'File ZIP không hợp lệ: thiếu persons.csv hoặc relationships.csv.'
    )
  }

  const personsCsvRaw = await personsFile.async('text')
  const relationshipsCsvRaw = await relationshipsFile.async('text')

  const personsCsvStr = personsCsvRaw.startsWith(UTF8_BOM)
    ? personsCsvRaw.slice(1)
    : personsCsvRaw
  const relationshipsCsvStr = relationshipsCsvRaw.startsWith(UTF8_BOM)
    ? relationshipsCsvRaw.slice(1)
    : relationshipsCsvRaw

  const personsParsed = Papa.parse<Partial<Person>>(personsCsvStr, {
    header: true,
    skipEmptyLines: true,
    transform: nullableCsvValue,
    dynamicTyping: (field) => typedPersonFields.has(String(field))
  })

  const relationshipsParsed = Papa.parse<Partial<Relationship>>(
    relationshipsCsvStr,
    {
      header: true,
      skipEmptyLines: true,
      transform: nullableCsvValue,
      dynamicTyping: false
    }
  )

  if (personsParsed.errors.length > 0) {
    console.error('Lỗi parse persons.csv:', personsParsed.errors)
  }

  if (relationshipsParsed.errors.length > 0) {
    console.error('Lỗi parse relationships.csv:', relationshipsParsed.errors)
  }

  const result: {
    persons: Partial<Person>[]
    relationships: Partial<Relationship>[]
    person_details_private?: PersonDetailsPrivateRow[]
    custom_events?: CustomEventRow[]
  } = {
    persons: personsParsed.data,
    relationships: relationshipsParsed.data
  }

  // Parse person_details_private.csv (optional, backward compat)
  const privateFile = loadedZip.file('person_details_private.csv')
  if (privateFile) {
    const raw = await privateFile.async('text')
    const privateCsvStr = raw.startsWith(UTF8_BOM) ? raw.slice(1) : raw
    const privateParsed = Papa.parse<PersonDetailsPrivateRow>(privateCsvStr, {
      header: true,
      skipEmptyLines: true,
      transform: nullableCsvValue,
      dynamicTyping: false
    })
    if (privateParsed.errors.length > 0) {
      console.error(
        'Lỗi parse person_details_private.csv:',
        privateParsed.errors
      )
    }
    result.person_details_private = privateParsed.data
  }

  // Parse custom_events.csv (optional, backward compat)
  const eventsFile = loadedZip.file('custom_events.csv')
  if (eventsFile) {
    const raw = await eventsFile.async('text')
    const eventsCsvStr = raw.startsWith(UTF8_BOM) ? raw.slice(1) : raw
    const eventsParsed = Papa.parse<CustomEventRow>(eventsCsvStr, {
      header: true,
      skipEmptyLines: true,
      transform: nullableCsvValue,
      dynamicTyping: false
    })
    if (eventsParsed.errors.length > 0) {
      console.error('Lỗi parse custom_events.csv:', eventsParsed.errors)
    }
    result.custom_events = eventsParsed.data
  }

  return result
}
