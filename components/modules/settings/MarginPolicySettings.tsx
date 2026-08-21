'use client'

import { ALL_CATEGORIES, fmtKes, type CategoryId } from '@/lib/store'
import { calculateMarginQuote } from '@/lib/pricing/margin-calculator'
import {
  DEFAULT_PRICING_MARGIN_POLICY,
  overheadRateFromPolicy,
  type PricingMarginPolicy,
} from '@/lib/pricing/margin-policy'
import { Field, Input, Select } from '@/components/ui'
import { MarginCalculatorTool } from '@/components/modules/settings/MarginCalculatorTool'

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden mb-3">
      <div className="px-4 py-2.5 border-b border-[var(--border-lt)] bg-[color-mix(in_srgb,var(--navy)_4%,var(--bg-card))]">
        <h3 className="text-[12.5px] font-bold text-[var(--text-1)] m-0">{title}</h3>
      </div>
      <div className="px-4 pb-3">{children}</div>
    </div>
  )
}

export function MarginPolicySettings({
  policy,
  onChange,
  onReset,
}: {
  policy: PricingMarginPolicy
  onChange: (next: PricingMarginPolicy) => void
  onReset: () => void
}) {
  const overheadPct = overheadRateFromPolicy(policy) * 100
  const exampleCost = 5000
  const exampleCat = policy.categories[0]
  const exampleQuote = exampleCat
    ? calculateMarginQuote({
        policy,
        buyCostKes: exampleCost,
        pricingCategoryId: exampleCat.id,
      })
    : null

  const patch = (partial: Partial<PricingMarginPolicy>) => onChange({ ...policy, ...partial })

  return (
    <>
      <MarginCalculatorTool policy={policy} />

      <SectionCard title="Margin policy (spreadsheet source of truth)">
        <p className="text-[11.5px] text-[var(--text-3)] pt-2 pb-2 leading-relaxed m-0">
          Selling (ex VAT) = cost ÷ (1 − overhead − target profit). Target profit is the category
          min/max band after the price-tier reduction. List price rounds up to the nearest{' '}
          {policy.roundUpKes} KES. Quote between min and max; Inventory fills retail/list at the
          max band. Partner API wholesale uses the min band unless a wholesale price is saved on
          the product.
        </p>
        <div className="flex flex-wrap items-center gap-3 py-2">
          <label className="inline-flex items-center gap-2 text-[12px] font-semibold text-[var(--text-1)]">
            <input
              type="checkbox"
              checked={policy.enabled}
              onChange={e => patch({ enabled: e.target.checked })}
            />
            Enable margin policy
          </label>
          <button type="button" className="btn-secondary text-[11px] px-2.5 py-1" onClick={onReset}>
            Reset to spreadsheet defaults
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <Field label="Annual revenue estimate (KES)">
            <Input
              type="number"
              value={String(policy.annualRevenueEstimateKes)}
              onChange={v => patch({ annualRevenueEstimateKes: Math.max(0, Number(v) || 0) })}
            />
          </Field>
          <Field label="Annual overhead (KES)">
            <Input
              type="number"
              value={String(policy.annualOverheadKes)}
              onChange={v => patch({ annualOverheadKes: Math.max(0, Number(v) || 0) })}
            />
          </Field>
          <Field label="VAT rate (%)">
            <Input
              type="number"
              value={String(policy.vatRatePct)}
              onChange={v => patch({ vatRatePct: Math.max(0, Number(v) || 0) })}
            />
          </Field>
          <Field label="Round up (KES)">
            <Input
              type="number"
              value={String(policy.roundUpKes)}
              onChange={v => patch({ roundUpKes: Math.max(1, Number(v) || 500) })}
            />
          </Field>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2.5 text-[12px]">
          <div className="font-bold text-[var(--navy)]">
            Overhead rate {overheadPct.toFixed(2)}%
          </div>
          <p className="text-[11px] text-[var(--text-3)] m-0 mt-1">
            Flows into every selling price. Example cost {fmtKes(exampleCost)}
            {exampleQuote?.ok
              ? ` → list ${fmtKes(exampleQuote.max.sellExVatRounded)} (reseller min ${fmtKes(exampleQuote.min.sellExVatRounded)}) for ${exampleQuote.category.name}`
              : ' · pick a category below to preview'}
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Category profit bands">
        <p className="text-[11px] text-[var(--text-3)] pt-2 pb-1 m-0">
          Min / max target profit after overhead (percent of selling price). Spreadsheet source of truth.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--text-4)]">
                <th className="py-2 pr-2">Category</th>
                <th className="py-2 pr-2 w-20">Min %</th>
                <th className="py-2 pr-2 w-20">Max %</th>
                <th className="py-2">Includes</th>
              </tr>
            </thead>
            <tbody>
              {policy.categories.map((cat, idx) => (
                <tr key={cat.id} className="border-t border-[var(--border-lt)] align-top">
                  <td className="py-2 pr-2 font-semibold text-[var(--text-1)]">{cat.name}</td>
                  <td className="py-2 pr-2">
                    <Input
                      type="number"
                      value={String(cat.minGpMarginPct)}
                      onChange={v => {
                        const n = Number(v)
                        if (!Number.isFinite(n)) return
                        const categories = policy.categories.map((c, i) =>
                          i === idx
                            ? { ...c, minGpMarginPct: n, maxGpMarginPct: Math.max(n, c.maxGpMarginPct) }
                            : c,
                        )
                        patch({ categories })
                      }}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      type="number"
                      value={String(cat.maxGpMarginPct)}
                      onChange={v => {
                        const n = Number(v)
                        if (!Number.isFinite(n)) return
                        const categories = policy.categories.map((c, i) =>
                          i === idx
                            ? { ...c, maxGpMarginPct: Math.max(c.minGpMarginPct, n) }
                            : c,
                        )
                        patch({ categories })
                      }}
                    />
                  </td>
                  <td className="py-2 text-[11px] text-[var(--text-3)]">{cat.itemsIncluded || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Price tier reductions">
        <p className="text-[11px] text-[var(--text-3)] pt-2 pb-1 m-0">
          Higher buy costs reduce the target profit band (approximate VLOOKUP on cost).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--text-4)]">
                <th className="py-2 pr-2">From (KES)</th>
                <th className="py-2 pr-2 w-24">Reduction %</th>
                <th className="py-2">Label</th>
              </tr>
            </thead>
            <tbody>
              {policy.tiers.map((tier, idx) => (
                <tr key={`${tier.priceFromKes}-${idx}`} className="border-t border-[var(--border-lt)]">
                  <td className="py-2 pr-2">
                    <Input
                      type="number"
                      value={String(tier.priceFromKes)}
                      onChange={v => {
                        const n = Math.max(0, Number(v) || 0)
                        const tiers = [...policy.tiers]
                        tiers[idx] = { ...tier, priceFromKes: n }
                        patch({ tiers: tiers.sort((a, b) => a.priceFromKes - b.priceFromKes) })
                      }}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      type="number"
                      value={String(tier.reductionPct)}
                      onChange={v => {
                        const n = Math.max(0, Number(v) || 0)
                        const tiers = policy.tiers.map((t, i) =>
                          i === idx ? { ...t, reductionPct: n } : t,
                        )
                        patch({ tiers })
                      }}
                    />
                  </td>
                  <td className="py-2 text-[11px] text-[var(--text-2)]">{tier.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="ERP category mapping">
        <p className="text-[11px] text-[var(--text-3)] pt-2 pb-1 m-0">
          Map Inventory categories to spreadsheet pricing bands. Laptops/Desktops also split by
          product type (new → Brand New PCs, refurbished → refurb band). Products may override
          with Pricing band on the product form (Monitors, Servers, Power Backup, etc.).
        </p>
        <div className="py-1 space-y-0">
          {ALL_CATEGORIES.map(erpCat => {
            const isPc = erpCat === 'Laptops' || erpCat === 'Desktops'
            const bandOptions = [
              { value: '', label: 'Unmapped (manual / legacy markup)' },
              ...policy.categories.map(c => ({ value: c.id, label: c.name })),
            ]
            const setRule = (condition: 'any' | 'new' | 'refurbished', pricingCategoryId: string) => {
              const rest = policy.categoryMap.filter(
                r => !(r.erpCategory === erpCat && (r.condition || 'any') === condition),
              )
              const next = pricingCategoryId
                ? [...rest, { erpCategory: erpCat as CategoryId, pricingCategoryId, condition }]
                : rest
              patch({ categoryMap: next })
            }
            const valueFor = (condition: 'any' | 'new' | 'refurbished') =>
              policy.categoryMap.find(r => r.erpCategory === erpCat && (r.condition || 'any') === condition)?.pricingCategoryId || ''
            return (
              <div
                key={erpCat}
                className="flex flex-col gap-2 py-2.5 border-b border-[var(--border-lt)] last:border-0"
              >
                <p className="text-[12.5px] font-semibold text-[var(--text-1)] m-0">{erpCat}</p>
                {isPc ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Field label="New">
                      <Select value={valueFor('new')} onChange={v => setRule('new', v)} options={bandOptions} />
                    </Field>
                    <Field label="Refurbished">
                      <Select value={valueFor('refurbished')} onChange={v => setRule('refurbished', v)} options={bandOptions} />
                    </Field>
                  </div>
                ) : (
                  <div className="w-full sm:w-72">
                    <Select value={valueFor('any')} onChange={v => setRule('any', v)} options={bandOptions} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <button
          type="button"
          className="btn-secondary text-[11px] px-2.5 py-1 mt-2"
          onClick={() =>
            patch({ categoryMap: [...DEFAULT_PRICING_MARGIN_POLICY.categoryMap] })
          }
        >
          Restore default mappings
        </button>
      </SectionCard>
    </>
  )
}
