'use client'

/**
 * Lead Scoring Component
 * 
 * Calculates and displays lead quality score based on:
 * - Company size/segment (Enterprise > SME > Startup)
 * - Expected value (higher = better)
 * - Lead source quality (Referral > Partner > Website > Cold)
 * - Engagement (activities logged)
 * - Decision maker contact (CEO/CTO > Manager > Individual)
 * - Time in pipeline (fresh leads score higher)
 */

export interface LeadScoreProps {
  opportunity: {
    id: string
    expectedValue: number
    leadSource: string
    createdAt: string
    stage: string
  }
  company?: {
    segment: 'enterprise' | 'sme' | 'startup' | 'government'
  }
  contactPerson?: {
    role: string
  }
  activitiesCount?: number
  size?: 'sm' | 'md' | 'lg'
}

const SCORE_WEIGHTS = {
  value: 0.3,
  source: 0.2,
  segment: 0.2,
  engagement: 0.15,
  decisionMaker: 0.1,
  freshness: 0.05,
}

const SOURCE_SCORES: Record<string, number> = {
  referral: 100,
  partner: 90,
  existing_customer: 85,
  website: 70,
  trade_show: 65,
  social_media: 60,
  email_campaign: 55,
  walk_in: 50,
  cold_call: 40,
}

const SEGMENT_SCORES: Record<string, number> = {
  enterprise: 100,
  government: 95,
  sme: 70,
  startup: 50,
}

const calculateLeadScore = (props: LeadScoreProps): number => {
  const { opportunity, company, contactPerson, activitiesCount = 0 } = props

  // 1. Value Score (0-100 based on expected value)
  // KES 1M+ = 100, KES 100K = 50, KES 10K = 20
  const valueScore = Math.min(100, (opportunity.expectedValue / 10000) * 1)

  // 2. Source Score
  const sourceScore = SOURCE_SCORES[opportunity.leadSource] || 50

  // 3. Segment Score
  const segmentScore = company ? SEGMENT_SCORES[company.segment] || 50 : 50

  // 4. Engagement Score (based on activities)
  // 10+ activities = 100, 5 = 50, 1 = 20, 0 = 0
  const engagementScore = Math.min(100, activitiesCount * 10)

  // 5. Decision Maker Score
  const role = contactPerson?.role?.toLowerCase() || ''
  let decisionMakerScore = 50
  if (role.includes('ceo') || role.includes('cto') || role.includes('director') || role.includes('owner')) {
    decisionMakerScore = 100
  } else if (role.includes('manager') || role.includes('head')) {
    decisionMakerScore = 75
  }

  // 6. Freshness Score (newer leads score higher)
  // < 7 days = 100, < 30 days = 80, < 90 days = 60, > 90 days = 40
  const daysOld = (Date.now() - new Date(opportunity.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  let freshnessScore = 100
  if (daysOld > 90) freshnessScore = 40
  else if (daysOld > 30) freshnessScore = 60
  else if (daysOld > 7) freshnessScore = 80

  // Weighted total
  const totalScore = Math.round(
    valueScore * SCORE_WEIGHTS.value +
    sourceScore * SCORE_WEIGHTS.source +
    segmentScore * SCORE_WEIGHTS.segment +
    engagementScore * SCORE_WEIGHTS.engagement +
    decisionMakerScore * SCORE_WEIGHTS.decisionMaker +
    freshnessScore * SCORE_WEIGHTS.freshness
  )

  return Math.min(100, Math.max(0, totalScore))
}

const getScoreColor = (score: number): string => {
  if (score >= 80) return '#12B76A' // Green - Hot
  if (score >= 60) return '#fec84b' // Yellow - Warm
  if (score >= 40) return '#F79009' // Orange - Cold
  return '#F04438' // Red - Ice Cold
}

const getScoreLabel = (score: number): string => {
  if (score >= 80) return 'Hot Lead'
  if (score >= 60) return 'Warm Lead'
  if (score >= 40) return 'Cold Lead'
  return 'Ice Cold'
}

const getScoreIcon = (score: number): string => {
  if (score >= 80) return '🔥'
  if (score >= 60) return '☀️'
  if (score >= 40) return '❄️'
  return '🧊'
}

export default function LeadScore(props: LeadScoreProps) {
  const { size = 'md' } = props
  const score = calculateLeadScore(props)
  const color = getScoreColor(score)
  const label = getScoreLabel(score)
  const icon = getScoreIcon(score)

  if (size === 'sm') {
    return (
      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold" style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}>
        <span>{icon}</span>
        <span>{score}</span>
      </div>
    )
  }

  if (size === 'lg') {
    return (
      <div className="bg-[#0c0e14] border border-white/10 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-[#98a2b3]">Lead Quality Score</div>
          <span className="text-2xl">{icon}</span>
        </div>
        
        <div className="flex items-baseline gap-2 mb-2">
          <div className="text-3xl font-bold" style={{ color }}>
            {score}
          </div>
          <div className="text-sm text-[#98a2b3]">/ 100</div>
        </div>
        
        <div className="text-sm font-semibold mb-3" style={{ color }}>
          {label}
        </div>

        {/* Score Bar */}
        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
          <div 
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${score}%`, background: color }}
          />
        </div>

        {/* Score Breakdown */}
        <div className="mt-4 space-y-2 text-xs text-[#98a2b3]">
          <div className="flex justify-between">
            <span>Expected Value:</span>
            <span className="text-white">
              {Math.round(calculateValueScore(props.opportunity.expectedValue))}%
            </span>
          </div>
          <div className="flex justify-between">
            <span>Lead Source:</span>
            <span className="text-white">
              {SOURCE_SCORES[props.opportunity.leadSource] || 50}%
            </span>
          </div>
          <div className="flex justify-between">
            <span>Engagement:</span>
            <span className="text-white">
              {Math.min(100, (props.activitiesCount || 0) * 10)}%
            </span>
          </div>
        </div>
      </div>
    )
  }

  // Default: md size
return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: `${color}18`, border: `1px solid ${color}30` }}>
      <span className="text-lg">{icon}</span>
      <div>
        <div className="text-sm font-bold" style={{ color }}>
          {score} / 100
        </div>
        <div className="text-xs" style={{ color, opacity: 0.8 }}>
          {label}
        </div>
      </div>
    </div>
  )
}

function calculateValueScore(value: number): number {
  return Math.min(100, (value / 10000) * 1)
}

export function LeadScoreIndicator({ score }: { score: number }) {
  const color = getScoreColor(score)
  const icon = getScoreIcon(score)
  
  return (
    <div className="inline-flex items-center gap-1" title={`Lead Score: ${score}`}>
      <span>{icon}</span>
      <span className="text-xs font-semibold" style={{ color }}>
        {score}
      </span>
    </div>
  )
}
