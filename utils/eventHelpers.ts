import { Lunar, Solar } from 'lunar-javascript'

import { MemorialDate } from '@/types/intake'
import { isValidMemorial } from '@/utils/memorial'

export type EventType = 'birthday' | 'death_anniversary' | 'custom_event'

export interface FamilyEvent {
  personId: string | null
  personName: string
  type: EventType
  /** Solar date of the next occurrence */
  nextOccurrence: Date
  /** Days until the next occurrence (negative = already passed this year, shown for context) */
  daysUntil: number
  /** Display label for the date of the event (e.g., "12/03" solar or "05/02 ÂL") */
  eventDateLabel: string
  /** The actual year of original event (birth year or death year) */
  originYear?: number | null
  originMonth?: number | null
  originDay?: number | null
  /** Whether the person is deceased */
  isDeceased: boolean
  isMemorial?: boolean
  /** Optional location for the event */
  location?: string | null
  /** Optional content/description for the event */
  content?: string | null
}

export interface CustomEventRecord {
  id: string
  name: string
  content: string | null
  event_date: string
  location: string | null
  created_by: string | null
}

/**
 * Finds the next solar Date on which a given lunar (month, day) falls,
 * starting from `fromDate`.
 */
function nextSolarForLunar(
  lunarMonth: number,
  lunarDay: number,
  fromDate: Date
): Date | null {
  // Derive the current lunar year by converting today's solar date to lunar
  const todaySolar = Solar.fromYmd(
    fromDate.getFullYear(),
    fromDate.getMonth() + 1,
    fromDate.getDate()
  )
  const currentLunarYear = todaySolar.getLunar().getYear()

  // A particular leap month may not recur for many years. Skip absent dates.
  for (let offset = 0; offset <= 20; offset++) {
    try {
      const l = Lunar.fromYmd(currentLunarYear + offset, lunarMonth, lunarDay)
      if (l.getMonth() !== lunarMonth || l.getDay() !== lunarDay) continue
      const s = l.getSolar()
      const candidate = new Date(s.getYear(), s.getMonth() - 1, s.getDay())
      if (candidate >= fromDate) return candidate
    } catch {
      // lunar date may not exist in this year (e.g., leap month); try next
    }
  }
  return null
}

/**
 * Computes upcoming FamilyEvents from a list of persons.
 * - Birthdays use the solar birth_month / birth_day.
 * - Death anniversaries (ngày giỗ) are observed on the *lunar* date of death.
 */
export function computeEvents(
  persons: (MemorialDate & {
    id: string
    full_name: string
    birth_year: number | null
    birth_month: number | null
    birth_day: number | null
    death_year: number | null
    death_month: number | null
    death_day: number | null
    death_lunar_year: number | null
    death_lunar_month: number | null
    death_lunar_day: number | null
    is_deceased: boolean
  })[],
  customEvents: CustomEventRecord[] = [],
  asOf: Date = new Date()
): FamilyEvent[] {
  const today = new Date(asOf)
  today.setHours(0, 0, 0, 0)
  const events: FamilyEvent[] = []

  for (const p of persons) {
    // ── Birthday (solar) ────────────────────────────────────────────
    if (p.birth_month && p.birth_day) {
      const thisYear = today.getFullYear()
      const thisYearDate = new Date(thisYear, p.birth_month - 1, p.birth_day)
      const isUpcoming = thisYearDate >= today

      // Next occurrence (upcoming)
      const next = isUpcoming
        ? thisYearDate
        : new Date(thisYear + 1, p.birth_month - 1, p.birth_day)

      const daysUntil = Math.round(
        (next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      )

      const baseEvent: FamilyEvent = {
        personId: p.id,
        personName: p.full_name,
        type: 'birthday',
        nextOccurrence: next,
        daysUntil,
        eventDateLabel: `${p.birth_day.toString().padStart(2, '0')}/${p.birth_month.toString().padStart(2, '0')}`,
        originYear: p.birth_year || null,
        originMonth: p.birth_month,
        originDay: p.birth_day,
        isDeceased: p.is_deceased
      }
      events.push(baseEvent)

      // Past occurrence (already happened this year)
      if (!isUpcoming) {
        const pastDaysUntil = Math.round(
          (thisYearDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        )
        events.push({
          ...baseEvent,
          nextOccurrence: thisYearDate,
          daysUntil: pastDaysUntil
        })
      }
    }

    // A separate memorial overrides the historical death-date recurrence.
    if (p.is_deceased) {
      const explicit = !!p.memorial_calendar && isValidMemorial(p)
      let calendar: 'lunar' | 'solar' = 'lunar'
      let month: number | null = null
      let day: number | null = null
      if (explicit) {
        calendar = p.memorial_calendar as 'lunar' | 'solar'
        month = p.memorial_month!
        day = p.memorial_day!
        if (calendar === 'lunar' && p.memorial_is_leap_month) month = -month
      } else if (p.death_lunar_month && p.death_lunar_day) {
        month = p.death_lunar_month
        day = p.death_lunar_day
      } else if (p.death_year && p.death_month && p.death_day) {
        // Never guess a lunar death date using today's year.
        try {
          const lunar = Solar.fromYmd(
            p.death_year,
            p.death_month,
            p.death_day
          ).getLunar()
          month = lunar.getMonth()
          day = lunar.getDay()
        } catch {
          /* Invalid historical dates produce no anniversary. */
        }
      }
      if (month && day) {
        try {
          let next: Date | null = null
          let past: Date | null = null
          if (calendar === 'solar') {
            for (let offset = 0; offset <= 8; offset++) {
              const candidate: Date = new Date(
                today.getFullYear() + offset,
                month - 1,
                day
              )
              if (
                candidate.getMonth() !== month - 1 ||
                candidate.getDate() !== day
              )
                continue
              if (candidate >= today) {
                next = candidate
                break
              }
              if (offset === 0) past = candidate
            }
          } else {
            next = nextSolarForLunar(month, day, today)
            const currentLunarYear = Solar.fromYmd(
              today.getFullYear(),
              today.getMonth() + 1,
              today.getDate()
            )
              .getLunar()
              .getYear()
            try {
              const lunar = Lunar.fromYmd(currentLunarYear, month, day)
              if (lunar.getMonth() === month && lunar.getDay() === day) {
                const solar = lunar.getSolar()
                const candidate = new Date(
                  solar.getYear(),
                  solar.getMonth() - 1,
                  solar.getDay()
                )
                if (candidate < today) past = candidate
              }
            } catch {
              /* Leap month/date absent in this year. */
            }
          }
          if (next) {
            const event: FamilyEvent = {
              personId: p.id,
              personName: p.full_name,
              type: 'death_anniversary',
              nextOccurrence: next,
              daysUntil: Math.round(
                (next.getTime() - today.getTime()) / 86400000
              ),
              eventDateLabel:
                String(day).padStart(2, '0') +
                '/' +
                String(Math.abs(month)).padStart(2, '0') +
                (month < 0 ? ' nhuận' : '') +
                (calendar === 'solar' ? ' DL' : ' ÂL'),
              originYear: explicit
                ? null
                : (p.death_lunar_year ?? p.death_year) || null,
              originMonth: Math.abs(month),
              originDay: day,
              isDeceased: true,
              isMemorial: explicit,
              content: explicit ? p.memorial_note : null
            }
            events.push(event)
            if (past)
              events.push({
                ...event,
                nextOccurrence: past,
                daysUntil: Math.round(
                  (past.getTime() - today.getTime()) / 86400000
                )
              })
          }
        } catch {
          /* Skip dates that cannot be represented in the selected calendar. */
        }
      }
    }
  }

  // ── Custom Events (solar) ───────────────────────────────────────
  for (const ce of customEvents) {
    if (!ce.event_date) continue
    const [y, m, d] = ce.event_date.split('-').map(Number)
    if (!y || !m || !d) continue

    const next = new Date(y, m - 1, d)
    const daysUntil = Math.round(
      (next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    )

    events.push({
      personId: ce.id, // using event id here
      personName: ce.name, // mapping custom event name to personName
      type: 'custom_event',
      nextOccurrence: next,
      daysUntil,
      eventDateLabel: `${d.toString().padStart(2, '0')}/${m.toString().padStart(2, '0')}/${y}`,
      originYear: y,
      isDeceased: false,
      location: ce.location,
      content: ce.content
    })
  }

  // Sort: soonest first
  events.sort((a, b) => a.daysUntil - b.daysUntil)
  return events
}
