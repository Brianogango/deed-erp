/**
 * Deterministic Contact (Client) match scoring.
 * Exact email/phone auto-match; never fuzzy-name-only auto-merge.
 */

import {
  emailDomainOf,
  normalizeEmail,
  normalizePhoneE164,
  phoneMatchKey,
} from '@/lib/crm/inbox/normalize'
import type { SalesInboxPipelineConfig } from '@/lib/crm/inbox/config'

export interface ContactCandidate {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  phoneAlt?: string | null
  companyName?: string | null
  website?: string | null
}

export interface ContactMatchResult {
  score: number
  matched: ContactCandidate | null
  reason: string
  band: 'AUTO_MATCH' | 'POSSIBLE_DUPLICATE' | 'NEW'
  enrich: {
    phone?: string
    companyName?: string
  }
  conflict: {
    phone?: { existing: string; incoming: string }
  }
}

function normName(s: string | null | undefined): string {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function scoreContactMatch(
  incoming: {
    email?: string | null
    phone?: string | null
    name?: string | null
    companyName?: string | null
  },
  candidate: ContactCandidate,
  config: SalesInboxPipelineConfig,
): number {
  let score = 0
  const inEmail = normalizeEmail(incoming.email)
  const candEmail = normalizeEmail(candidate.email)
  if (inEmail && candEmail && inEmail === candEmail) score = Math.max(score, 100)

  const inPhone = phoneMatchKey(incoming.phone)
  const candPhone = phoneMatchKey(candidate.phone) || phoneMatchKey(candidate.phoneAlt)
  if (inPhone && candPhone && inPhone === candPhone) score = Math.max(score, 95)

  const sameName = normName(incoming.name) && normName(incoming.name) === normName(candidate.name)
  const sameCompany =
    normName(incoming.companyName)
    && normName(incoming.companyName) === normName(candidate.companyName)
  if (sameName && sameCompany) score = Math.max(score, 80)
  if (sameName && inPhone && candPhone && inPhone === candPhone) score = Math.max(score, 85)
  if (sameName) score = Math.max(score, 40)

  const inDomain = emailDomainOf(inEmail)
  const candDomain = emailDomainOf(candEmail)
  if (
    inDomain
    && candDomain
    && inDomain === candDomain
    && !config.publicEmailDomains.has(inDomain)
  ) {
    score = Math.max(score, 30)
  }

  return score
}

export function resolveContactMatch(
  incoming: {
    email?: string | null
    phone?: string | null
    name?: string | null
    companyName?: string | null
  },
  candidates: ContactCandidate[],
  config: SalesInboxPipelineConfig,
): ContactMatchResult {
  let best: ContactCandidate | null = null
  let bestScore = 0
  let reason = 'no_match'

  for (const c of candidates) {
    const s = scoreContactMatch(incoming, c, config)
    if (s > bestScore) {
      bestScore = s
      best = c
      reason = s >= 100 ? 'exact_email' : s >= 95 ? 'exact_phone' : s >= 80 ? 'name_company' : 'weak'
    }
  }

  const band: ContactMatchResult['band'] =
    bestScore >= 90 ? 'AUTO_MATCH' : bestScore >= 70 ? 'POSSIBLE_DUPLICATE' : 'NEW'

  const enrich: ContactMatchResult['enrich'] = {}
  const conflict: ContactMatchResult['conflict'] = {}

  if (best && band === 'AUTO_MATCH') {
    const incomingPhone = normalizePhoneE164(incoming.phone)
    const existingPhone = normalizePhoneE164(best.phone) || normalizePhoneE164(best.phoneAlt)
    if (incomingPhone) {
      if (!existingPhone) enrich.phone = incomingPhone
      else if (phoneMatchKey(incomingPhone) !== phoneMatchKey(existingPhone)) {
        conflict.phone = { existing: existingPhone, incoming: incomingPhone }
      }
    }
    if (incoming.companyName && !best.companyName) {
      enrich.companyName = String(incoming.companyName).slice(0, 200)
    }
  }

  return {
    score: bestScore,
    matched: band === 'AUTO_MATCH' ? best : null,
    reason,
    band,
    enrich,
    conflict,
  }
}

/** Company inference: never from public email domains. */
export function inferCompanyFromDomain(
  email: string | null | undefined,
  config: SalesInboxPipelineConfig,
  explicitCompany?: string | null,
): string | null {
  if (explicitCompany && String(explicitCompany).trim()) {
    return String(explicitCompany).trim().slice(0, 200)
  }
  const domain = emailDomainOf(email)
  if (!domain || config.publicEmailDomains.has(domain)) return null
  if (config.internalDomains.has(domain)) return null
  const base = domain.split('.')[0]
  if (!base || base.length < 3) return null
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 200)
}
