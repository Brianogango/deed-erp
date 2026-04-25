import { OpportunityStage, LeadSource } from '@/lib/store'

export const STAGE_ORDER: OpportunityStage[] = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost']

export const STAGE_LABELS: Record<OpportunityStage, string> = {
  prospecting: 'Prospecting',
  qualification: 'Qualification',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  closed_won: 'Won',
  closed_lost: 'Lost',
  on_hold: 'On Hold',
}

export const STAGE_COLORS: Record<OpportunityStage, string> = {
  prospecting: 'var(--text-3)',
  qualification: '#2E90FA',
  proposal: '#F59E0B',
  negotiation: '#8B5CF6',
  closed_won: '#12B76A',
  closed_lost: '#F04438',
  on_hold: 'var(--text-3)',
}

export const LEAD_SOURCE_OPTIONS: { value: LeadSource; label: string }[] = [
  { value: 'website', label: 'Website' }, { value: 'referral', label: 'Referral' },
  { value: 'cold_call', label: 'Cold Call' }, { value: 'email_campaign', label: 'Email Campaign' },
  { value: 'social_media', label: 'Social Media' }, { value: 'trade_show', label: 'Trade Show' },
  { value: 'partner', label: 'Partner' }, { value: 'existing_customer', label: 'Existing Customer' },
  { value: 'walk_in', label: 'Walk-in' },
]