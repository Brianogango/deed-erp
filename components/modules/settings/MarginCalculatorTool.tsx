'use client'

import { useMemo, useState } from 'react'
import { fmtKes } from '@/lib/store'
import { calculateMarginQuote } from '@/lib/pricing/margin-calculator'
import {
  normalizePricingMarginPolicy,
  overheadRateFromPolicy,
  type PricingMarginPolicy,
} from '@/lib/pricing/margin-policy'
import { Field, Input, Select } from '@/components/ui'

/**
 * Interactive port of the spreadsheet Calculator tab:
 * Step 1 category → Step 2 buy cost → Step 3 recommended sell / invoice bands.
 */
export function MarginCalculatorTool({
  policy: rawPolicy,
  initialCategoryId,
  initialCost,
  compact = false,
}: {
  policy: PricingMarginPolicy | Partial<PricingMarginPolicy> | null | undefined
  initialCategoryId?: string
  initialCost?: number | string
  compact?: boolean
}) {
  const policy = normalizePricingMarginPolicy(rawPolicy)
  const [categoryId, setCategoryId] = useState(
    initialCategoryId && policy.categories.some(c => c.id === initialCategoryId)
      ? initialCategoryId
      : policy.categories.find(c => c.id === 'repair_parts')?.id || policy.categories[0]?.id || '',
  )
  const [buyCost, setBuyCost] = useState(
    initialCost !== undefined && initialCost !== '' ? String(initialCost) : '5000',
  )

  const overheadPct = overheadRateFromPolicy(policy) * 100
  const category = policy.categories.find(c => c.id === categoryId) || null
  const costNum = Number(buyCost)

  const quote = useMemo(() => {
    if (!categoryId || !Number.isFinite(costNum) || costNum <= 0) return null
    return calculateMarginQuote({
      policy,
      buyCostKes: costNum,
      pricingCategoryId: categoryId,
    })
  }, [policy, categoryId, costNum])

  return (
    <div className={`rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden ${compact ? '' : 'mb-3'}`}>
      <div className="px-4 py-2.5 border-b border-[var(--border-lt)] bg-[color-mix(in_srgb,var(--navy)_6%,var(--bg-card))]">
        <h3 className="text-[12.5px] font-bold text-[var(--text-1)] m-0">Margin calculator</h3>
        <p className="text-[11px] text-[var(--text-3)] m-0 mt-0.5">
          Same logic as the Margins spreadsheet. Quote between min and max (ex VAT).
        </p>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <p className="text-[11px] font-bold text-[var(--text-2)] mb-2">Select category</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Category">
              <Select
                value={categoryId}
                onChange={setCategoryId}
                options={policy.categories.map(c => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <Field label="Target profit min">
              <Input value={category ? `${category.minGpMarginPct}%` : '-'} onChange={() => {}} disabled />
            </Field>
            <Field label="Target profit max">
              <Input value={category ? `${category.maxGpMarginPct}%` : '-'} onChange={() => {}} disabled />
            </Field>
          </div>
          <p className="text-[11px] text-[var(--text-3)] mt-1.5 m-0">
            Overhead rate {overheadPct.toFixed(2)}% (from annual overhead ÷ revenue)
            {category?.itemsIncluded ? ` · ${category.itemsIncluded}` : ''}
          </p>
        </div>

        <div>
          <p className="text-[11px] font-bold text-[var(--text-2)] mb-2">Enter buy (cost) price</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Buy price (KES, ex VAT)">
              <Input
                type="number"
                value={buyCost}
                onChange={setBuyCost}
                placeholder="Cost before VAT"
              />
            </Field>
            <Field label="Price tier reduction">
              <Input
                value={
                  quote?.ok
                    ? `${quote.tierReductionPct}%${quote.tierLabel ? ` (${quote.tierLabel})` : ''}`
                    : '-'
                }
                onChange={() => {}}
                disabled
              />
            </Field>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-bold text-[var(--text-2)] mb-2">Recommended selling prices</p>
          {!quote?.ok ? (
            <p className="text-[12px] text-[var(--text-3)] m-0">
              {quote && !quote.ok ? quote.error : 'Enter a buy price to calculate.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--text-4)]">
                    <th className="py-1.5 pr-2"> </th>
                    <th className="py-1.5 pr-2">Min</th>
                    <th className="py-1.5 pr-2">Max</th>
                    <th className="py-1.5">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-[var(--border-lt)]">
                    <td className="py-2 pr-2 text-[var(--text-3)]">Effective target margin</td>
                    <td className="py-2 pr-2 font-mono tabular-nums">{quote.min.effectiveMarginPct.toFixed(2)}%</td>
                    <td className="py-2 pr-2 font-mono tabular-nums">{quote.max.effectiveMarginPct.toFixed(2)}%</td>
                    <td className="py-2 text-[11px] text-[var(--text-3)]">After tier reduction</td>
                  </tr>
                  <tr className="border-t border-[var(--border-lt)]">
                    <td className="py-2 pr-2 text-[var(--text-3)]">Pricing divisor</td>
                    <td className="py-2 pr-2 font-mono tabular-nums">{quote.min.pricingDivisor.toFixed(3)}</td>
                    <td className="py-2 pr-2 font-mono tabular-nums">{quote.max.pricingDivisor.toFixed(3)}</td>
                    <td className="py-2 text-[11px] text-[var(--text-3)]">1 - overhead - effective margin</td>
                  </tr>
                  <tr className="border-t border-[var(--border-lt)]">
                    <td className="py-2 pr-2 text-[var(--text-3)]">Selling price (ex VAT)</td>
                    <td className="py-2 pr-2 font-mono tabular-nums font-semibold text-[var(--navy)]">
                      {fmtKes(quote.min.sellExVatRounded)}
                    </td>
                    <td className="py-2 pr-2 font-mono tabular-nums font-semibold text-[var(--navy)]">
                      {fmtKes(quote.max.sellExVatRounded)}
                    </td>
                    <td className="py-2 text-[11px] text-[var(--text-3)]">
                      Raw {fmtKes(Math.round(quote.min.sellExVat))} / {fmtKes(Math.round(quote.max.sellExVat))} ·
                      round up by {quote.roundUpKes}
                    </td>
                  </tr>
                  <tr className="border-t border-[var(--border-lt)]">
                    <td className="py-2 pr-2 text-[var(--text-3)]">Invoice price (inc VAT {quote.vatRatePct}%)</td>
                    <td className="py-2 pr-2 font-mono tabular-nums">{fmtKes(Math.round(quote.min.invoiceIncVat))}</td>
                    <td className="py-2 pr-2 font-mono tabular-nums">{fmtKes(Math.round(quote.max.invoiceIncVat))}</td>
                    <td className="py-2 text-[11px] text-[var(--text-3)]">
                      Rounded invoice {fmtKes(quote.min.invoiceIncVatRounded)} / {fmtKes(quote.max.invoiceIncVatRounded)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="text-[11px] text-[var(--text-3)] mt-2 m-0">
                Classic GP floor for approvals: {quote.approvalMinGrossMarginPct.toFixed(2)}% (overhead + effective min).
                List/retail suggestion: {fmtKes(quote.max.sellExVatRounded)}.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
