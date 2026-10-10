import { describe, expect, it } from 'vitest'
import { buildCandidateEmail, formatInterviewTime, longDate } from '@/lib/hr/recruitment-mail'
import { buildOfferLetterPdf } from '@/lib/hr/offer-letter'

const base = { companyName: 'Deed Technologies', candidateName: 'Ann Mwangi', jobTitle: 'Sales Executive', hrEmail: 'hr@deed.co.ke' }

describe('candidate emails', () => {
  it('formats the interview time in East Africa Time', () => {
    expect(formatInterviewTime('2026-10-12T14:30')).toBe('Monday, 12 October 2026 at 2:30 PM (EAT)')
    expect(formatInterviewTime('2026-10-12T00:05')).toBe('Monday, 12 October 2026 at 12:05 AM (EAT)')
    expect(longDate('2026-12-25')).toBe('Friday, 25 December 2026')
  })

  it('invites to interview with the time, format, venue and interviewer', () => {
    const m = buildCandidateEmail({ ...base, kind: 'interview_invite', interview: { scheduledAt: '2026-10-12T10:00', mode: 'in_person', interviewer: 'Brian', location: 'Westlands office' } })
    expect(m.subject).toBe('Interview invitation: Sales Executive')
    expect(m.text).toContain('Monday, 12 October 2026 at 10:00 AM (EAT)')
    expect(m.text).toContain('Venue: Westlands office')
    expect(m.text).toContain('You will meet: Brian')
    expect(m.html).toContain('Westlands office')
  })

  it('rejects kindly without giving an internal reason', () => {
    const m = buildCandidateEmail({ ...base, kind: 'rejection' })
    expect(m.text).toContain('decided not to take your application further')
    expect(m.text.toLowerCase()).not.toMatch(/salary expectations|failed|not enough experience/)
  })

  it('mentions the attached offer letter and has no salary figure', () => {
    const m = buildCandidateEmail({ ...base, kind: 'offer', offer: { startDate: '2026-11-02', validUntil: '2026-10-20' } })
    expect(m.text).toContain('attached as a PDF')
    expect(m.text).toContain('Monday, 2 November 2026')
    expect(m.text).toContain('by Tuesday, 20 October 2026')
    expect(`${m.text}${m.html}`).not.toMatch(/KSh|\d{2},\d{3}/)
  })

  it('escapes names in the html', () => {
    const m = buildCandidateEmail({ ...base, kind: 'rejection', candidateName: '<script>x</script>' })
    expect(m.html).not.toContain('<script>')
  })
})

describe('offer letter', () => {
  it('builds a single page', () => {
    const doc = buildOfferLetterPdf({
      candidateName: 'Ann Mwangi', jobTitle: 'Sales Executive', department: 'Sales', location: 'Nairobi', employmentType: 'full_time',
      startDate: '2026-11-02', monthlyBasicSalary: 85000, probationMonths: 3, reportsTo: 'Head of Sales', validUntil: '2026-10-20',
      additionalTerms: 'Company laptop and phone provided.', issuedOn: '2026-10-10',
    }, { name: 'Deed Technologies', kraPin: 'P051999898X' })
    expect(doc.getNumberOfPages()).toBe(1)
  })
})
