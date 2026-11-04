import { MemorialDate } from '@/types/intake'

export interface GedcomPerson extends MemorialDate {
  id?: string
  full_name?: string | null
  gender?: 'male' | 'female' | 'other' | string
  birth_year_from?: number | null
  birth_year_to?: number | null
  death_year_from?: number | null
  death_year_to?: number | null
  birth_year?: number | null
  birth_month?: number | null
  birth_day?: number | null
  death_year?: number | null
  death_month?: number | null
  death_day?: number | null
  is_deceased?: boolean
  is_in_law?: boolean
  birth_order?: number | null
  generation?: number | null
  avatar_url?: string | null
  note?: string | null
}

export interface GedcomRelationship {
  type?: string
  person_a?: string
  person_b?: string
}

export function exportToGedcom(data: {
  persons: (GedcomPerson & { family_branch_id?: string | null })[]
  relationships: (GedcomRelationship & { family_branch_id?: string | null })[]
  family_branches?: unknown[]
  family_branch_members?: unknown[]
}): string {
  if (
    data.family_branches?.length ||
    data.family_branch_members?.length ||
    data.persons.some((person) => person.family_branch_id) ||
    data.relationships.some((relationship) => relationship.family_branch_id)
  ) {
    throw new Error('Auxiliary branch data requires JSON backup.')
  }
  let gedcom = ''

  // Header (GEDCOM 7.0)
  gedcom += '0 HEAD\n'
  gedcom += '1 GEDC\n'
  gedcom += '2 VERS 7.0\n'
  gedcom += '1 SOUR Giapha_OS\n'
  gedcom += '2 NAME Giapha OS\n'
  gedcom += '2 VERS 0.1.0\n'

  const personMap = new Map(
    data.persons.filter((p) => !!p.id).map((p) => [p.id!, p])
  )

  // Map original IDs to short export IDs (to satisfy 20-char XREF limit)
  const exportIdMap = new Map<string, string>()
  let personCounter = 1
  for (const person of data.persons) {
    if (person.id) {
      exportIdMap.set(person.id, `I${personCounter++}`)
    }
  }

  const getIndiXref = (id: string | undefined) =>
    id ? `@${exportIdMap.get(id) || id.replace(/-/g, '')}@` : ''

  // Helper formatting Date
  const formatNum = (n: number | null) =>
    n && n > 0 ? String(n).padStart(2, '0') : ''

  // Pre-process Families
  let familyCounter = 1
  const marriages = data.relationships.filter((r) => r.type === 'marriage')
  const childrenRels = data.relationships.filter(
    (r) => r.type === 'biological_child' || r.type === 'adopted_child'
  )

  const families: {
    id: string
    husb?: string
    wife?: string
    children: { id: string; type: string }[]
  }[] = []

  for (const marriage of marriages) {
    if (!marriage.person_a || !marriage.person_b) continue
    const pA = personMap.get(marriage.person_a)
    const pB = personMap.get(marriage.person_b)
    if (!pA || !pB || !pA.id || !pB.id) continue

    const fam = {
      id: `F${familyCounter++}`,
      husb: pA.gender === 'male' ? pA.id : pB.gender === 'male' ? pB.id : pA.id,
      wife: pA.gender === 'male' ? pB.id : pB.gender === 'male' ? pA.id : pB.id,
      children: [] as { id: string; type: string }[]
    }
    families.push(fam)
  }

  // Only attach a child to a couple when both parent links have that pedigree.
  for (const child of data.persons) {
    if (!child.id) continue
    for (const type of ['biological_child', 'adopted_child']) {
      const parents = [
        ...new Set(
          childrenRels
            .filter((rel) => rel.person_b === child.id && rel.type === type)
            .map((rel) => rel.person_a)
            .filter((id): id is string => !!id && personMap.has(id))
        )
      ]
      const couple =
        parents.length === 2
          ? families.find(
              (fam) =>
                fam.husb &&
                fam.wife &&
                parents.includes(fam.husb) &&
                parents.includes(fam.wife)
            )
          : undefined
      if (couple) {
        couple.children.push({ id: child.id, type })
        continue
      }
      // Separate parent records avoid inferring a spouse or a marriage.
      for (const parentId of parents) {
        let fam = families.find(
          (f) =>
            (f.husb === parentId && !f.wife) || (f.wife === parentId && !f.husb)
        )
        if (!fam) {
          const female = personMap.get(parentId)?.gender === 'female'
          fam = {
            id: `F${familyCounter++}`,
            husb: female ? undefined : parentId,
            wife: female ? parentId : undefined,
            children: []
          }
          families.push(fam)
        }
        fam.children.push({ id: child.id, type })
      }
    }
  }

  // Map persons to their families (for FAMC and FAMS)
  const personFamc = new Map<string, { id: string; type: string }[]>()
  const personFams = new Map<string, string[]>()

  for (const fam of families) {
    if (fam.husb) {
      const current = personFams.get(fam.husb) || []
      if (!current.includes(fam.id))
        personFams.set(fam.husb, [...current, fam.id])
    }
    if (fam.wife) {
      const current = personFams.get(fam.wife) || []
      if (!current.includes(fam.id))
        personFams.set(fam.wife, [...current, fam.id])
    }
    for (const child of fam.children) {
      const current = personFamc.get(child.id) || []
      personFamc.set(child.id, [...current, { id: fam.id, type: child.type }])
    }
  }

  // Export Individuals
  for (const person of data.persons) {
    if (!person.id) continue
    gedcom += `0 ${getIndiXref(person.id)} INDI\n`

    // Name
    if (person.full_name) {
      const parts = person.full_name.trim().split(' ')
      const lastName = parts.length > 1 ? parts.pop() : ''
      const firstName = parts.join(' ')
      gedcom += `1 NAME ${firstName} /${lastName}/\n`
    } else {
      gedcom += `1 NAME Unknown /Unknown/\n`
    }

    // Sex
    if (person.gender === 'male') gedcom += '1 SEX M\n'
    else if (person.gender === 'female') gedcom += '1 SEX F\n'
    else gedcom += '1 SEX U\n'

    // Birth
    if (person.birth_year_from != null && person.birth_year_to != null) {
      gedcom += `1 BIRT\n2 DATE BET ${person.birth_year_from} AND ${person.birth_year_to}\n`
    } else if (person.birth_year || person.birth_month || person.birth_day) {
      gedcom += '1 BIRT\n'
      const day = formatNum(person.birth_day ?? null)
      const mont = getMonthName(person.birth_month ?? null)
      const yea = person.birth_year ? String(person.birth_year) : ''
      const dateParts = [day, mont, yea].filter(Boolean)
      if (dateParts.length > 0) {
        gedcom += `2 DATE ${dateParts.join(' ')}\n`
      }
    }

    // Death
    if (person.is_deceased) {
      gedcom += '1 DEAT Y\n'
      if (person.death_year_from != null && person.death_year_to != null) {
        gedcom += `2 DATE BET ${person.death_year_from} AND ${person.death_year_to}\n`
      } else if (person.death_year || person.death_month || person.death_day) {
        const day = formatNum(person.death_day ?? null)
        const mont = getMonthName(person.death_month ?? null)
        const yea = person.death_year ? String(person.death_year) : ''
        const dateParts = [day, mont, yea].filter(Boolean)
        if (dateParts.length > 0) {
          gedcom += `2 DATE ${dateParts.join(' ')}\n`
        }
      }
    }

    if (
      person.memorial_day &&
      person.memorial_month &&
      person.memorial_calendar
    ) {
      gedcom +=
        '1 _MEMORIAL\n2 _DAY ' +
        person.memorial_day +
        '\n2 _MONTH ' +
        person.memorial_month +
        '\n2 _CALENDAR ' +
        person.memorial_calendar.toUpperCase() +
        '\n2 _LEAP ' +
        (person.memorial_is_leap_month ? 'Y' : 'N') +
        '\n'
      if (person.memorial_note)
        gedcom +=
          '2 NOTE ' +
          person.memorial_note
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .join('\n3 CONT ') +
          '\n'
    }

    // Family Links
    const famcs = personFamc.get(person.id) || []
    for (const fam of famcs) {
      gedcom += `1 FAMC @${fam.id}@\n2 PEDI ${fam.type === 'adopted_child' ? 'ADOPTED' : 'BIRTH'}\n`
    }
    const famss = personFams.get(person.id) || []
    for (const famId of famss) {
      gedcom += `1 FAMS @${famId}@\n`
    }

    // Note
    if (person.note) {
      const lines = person.note.split('\n')
      gedcom += `1 NOTE ${lines[0]}\n`
      for (let i = 1; i < lines.length; i++) {
        gedcom += `2 CONT ${lines[i]}\n`
      }
    }
  }

  for (const fam of families) {
    gedcom += `0 @${fam.id}@ FAM\n`
    if (fam.husb) gedcom += `1 HUSB ${getIndiXref(fam.husb)}\n`
    if (fam.wife) gedcom += `1 WIFE ${getIndiXref(fam.wife)}\n`
    for (const childId of new Set(fam.children.map((child) => child.id))) {
      gedcom += `1 CHIL ${getIndiXref(childId)}\n`
    }
  }

  gedcom += '0 TRLR\n'
  return gedcom
}

function getMonthName(month: number | null): string {
  if (!month) return ''
  const months = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC'
  ]
  return months[month - 1] || ''
}

function parseMonthName(name: string): number | null {
  const months = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC'
  ]
  const index = months.findIndex((m) => m === name.toUpperCase())
  return index !== -1 ? index + 1 : null
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function parseGedcom(gedcom: string): {
  persons: GedcomPerson[]
  relationships: GedcomRelationship[]
} {
  const lines = gedcom.split(/\r?\n/).filter((line) => line.trim().length > 0)

  const persons: GedcomPerson[] = []
  const relationships: GedcomRelationship[] = []
  const idMap = new Map<string, string>()
  const pedigrees = new Map<string, string>()

  type ParseRecord = {
    type: 'INDI' | 'FAM'
    id: string
    lines: string[]
  }

  const records: ParseRecord[] = []
  let currentRecord: ParseRecord | null = null

  for (const line of lines) {
    if (line.startsWith('0 ')) {
      if (currentRecord) records.push(currentRecord)
      const match = line.match(/^0\s+@([^@]+)@\s+(INDI|FAM)/)
      if (match) {
        currentRecord = {
          id: match[1],
          type: match[2] as 'INDI' | 'FAM',
          lines: []
        }
      } else {
        currentRecord = null
      }
    } else if (currentRecord) {
      currentRecord.lines.push(line.trim())
    }
  }
  if (currentRecord) records.push(currentRecord)

  // Parse Individuals
  for (const record of records.filter((r) => r.type === 'INDI')) {
    const uuid = generateUUID()
    idMap.set(record.id, uuid)

    let fullName = 'Unknown'
    let gender: 'male' | 'female' | 'other' = 'other'
    let is_deceased = false
    let birth_day = null
    let birth_month = null
    let birth_year = null
    let birth_year_from = null
    let birth_year_to = null
    let death_day = null
    let death_month = null
    let death_year = null
    let death_year_from = null
    let death_year_to = null
    let note = ''
    const memorial: MemorialDate = {
      memorial_day: null,
      memorial_month: null,
      memorial_calendar: null,
      memorial_is_leap_month: false,
      memorial_note: null
    }

    let currentTag = ''
    let currentFamily = ''

    for (let i = 0; i < record.lines.length; i++) {
      const line = record.lines[i]
      const match = line.match(/^(\d+)\s+([A-Z0-9_]+)(?:\s+(.*))?$/)
      if (!match) continue

      const level = parseInt(match[1])
      const tag = match[2]
      const val = match[3] || ''

      if (currentTag === '_MEMORIAL' && level === 3 && tag === 'CONT') {
        memorial.memorial_note = (memorial.memorial_note || '') + '\n' + val
      } else if (currentTag === '_MEMORIAL' && level === 2) {
        if (tag === '_DAY') memorial.memorial_day = Number(val)
        else if (tag === '_MONTH') memorial.memorial_month = Number(val)
        else if (tag === '_CALENDAR')
          memorial.memorial_calendar = val.toLowerCase() as 'lunar' | 'solar'
        else if (tag === '_LEAP') memorial.memorial_is_leap_month = val === 'Y'
        else if (tag === 'NOTE') memorial.memorial_note = val
      } else if (level === 1) {
        currentTag = tag
        if (tag === 'FAMC') currentFamily = val.replace(/@/g, '')
        if (tag === 'NAME') {
          fullName = val.replace(/\//g, '').trim()
        } else if (tag === 'SEX') {
          if (val === 'M') gender = 'male'
          else if (val === 'F') gender = 'female'
        } else if (tag === 'DEAT') {
          is_deceased = val.trim().length === 0 || val === 'Y'
        } else if (tag === 'NOTE') {
          note = val
        }
      } else if (level === 2) {
        if (currentTag === 'FAMC' && tag === 'PEDI') {
          pedigrees.set(`${uuid}_${currentFamily}`, val.toUpperCase())
        } else if (currentTag === 'NOTE' && tag === 'CONT') {
          note += '\n' + val
        } else if (currentTag === 'BIRT' && tag === 'DATE') {
          const range = val.match(/^BET\s+(\d{1,4})\s+AND\s+(\d{1,4})$/i)
          if (range) {
            birth_year_from = Number(range[1])
            birth_year_to = Number(range[2])
            continue
          }
          const cleanVal = val.replace(/^(ABT|EST|AFT|BEF|CAL)\s+/i, '')
          const parts = cleanVal.split(' ')
          if (parts.length === 3) {
            birth_day = parseInt(parts[0]) || null
            birth_month = parseMonthName(parts[1])
            birth_year = parseInt(parts[2]) || null
          } else if (parts.length === 1) {
            birth_year = parseInt(parts[0]) || null
          } else if (parts.length === 2) {
            birth_month = parseMonthName(parts[0])
            birth_year = parseInt(parts[1]) || null
          }
        } else if (currentTag === 'DEAT' && tag === 'DATE') {
          is_deceased = true
          const range = val.match(/^BET\s+(\d{1,4})\s+AND\s+(\d{1,4})$/i)
          if (range) {
            death_year_from = Number(range[1])
            death_year_to = Number(range[2])
            continue
          }
          const cleanVal = val.replace(/^(ABT|EST|AFT|BEF|CAL)\s+/i, '')
          const parts = cleanVal.split(' ')
          if (parts.length === 3) {
            death_day = parseInt(parts[0]) || null
            death_month = parseMonthName(parts[1])
            death_year = parseInt(parts[2]) || null
          } else if (parts.length === 1) {
            death_year = parseInt(parts[0]) || null
          } else if (parts.length === 2) {
            death_month = parseMonthName(parts[0])
            death_year = parseInt(parts[1]) || null
          }
        }
      }
    }

    persons.push({
      id: uuid,
      ...memorial,
      full_name: fullName,
      gender,
      is_deceased,
      birth_year_from,
      birth_year_to,
      death_year_from,
      death_year_to,
      birth_day: Number.isNaN(birth_day) ? null : birth_day,
      birth_month,
      birth_year: Number.isNaN(birth_year) ? null : birth_year,
      death_day: Number.isNaN(death_day) ? null : death_day,
      death_month,
      death_year: Number.isNaN(death_year) ? null : death_year,
      is_in_law: false,
      birth_order: null,
      generation: null,
      avatar_url: null,
      note: note.length > 0 ? note : null
    })
  }

  // Parse Families
  for (const record of records.filter((r) => r.type === 'FAM')) {
    let husb = null
    let wife = null
    const children: string[] = []

    for (const line of record.lines) {
      const match = line.match(/^1\s+(HUSB|WIFE|CHIL)\s+@([^@]+)@/)
      if (match) {
        const tag = match[1]
        const refId = match[2]
        const uuid = idMap.get(refId)
        if (!uuid) continue

        if (tag === 'HUSB') husb = uuid
        else if (tag === 'WIFE') wife = uuid
        else if (tag === 'CHIL') children.push(uuid)
      }
    }

    if (husb && wife && husb !== wife) {
      relationships.push({
        type: 'marriage',
        person_a: husb,
        person_b: wife
      })
    }

    // Assigning children to both parents
    for (const childId of children) {
      const type =
        pedigrees.get(`${childId}_${record.id}`) === 'ADOPTED'
          ? 'adopted_child'
          : 'biological_child'
      if (husb && husb !== childId) {
        relationships.push({
          type,
          person_a: husb,
          person_b: childId
        })
      }
      if (wife && wife !== childId) {
        relationships.push({
          type,
          person_a: wife,
          person_b: childId
        })
      }
    }
  }

  // Deduplicate relationships to prevent database unique constraint errors
  const uniqueRelationships: GedcomRelationship[] = []
  const seenKeys = new Set<string>()

  for (const rel of relationships) {
    const key = `${rel.type}_${rel.person_a}_${rel.person_b}`
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      uniqueRelationships.push(rel)
    }
  }

  return { persons, relationships: uniqueRelationships }
}
