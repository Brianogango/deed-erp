import { describe, expect, it } from 'vitest'
import {
  assertBuyBackLinesBalanced,
  buildBuyBackPayoutLines,
  buildBuyBackStockLines,
  buyBackPayoutRef,
} from '@/lib/accounting/buyback-journals'
import { resolveSerialCogs } from '@/lib/inventory/serial-cogs'
import {
  detectStatementFormat,
  fingerprintStatementLine,
  parseBankStatementCsv,
  parseBankStatementOfx,
} from '@/lib/accounting/bank-statement-import'
import { buildYearEndCloseLines } from '@/lib/accounting/year-end-close'
import { buildVatRemittanceLines } from '@/lib/accounting/vat-remittance'
import { distributeAnalyticAmount, budgetVariance } from '@/lib/accounting/analytics'
import { DEFAULT_COA_ALIASES, displayCodeFor, resolveLiveCode } from '@/lib/accounting/coa-alias'
import { COA_ROLE_CODES } from '@/lib/accounting/coa-roles'

const sampleBb = {
  id: 'bb-1',
  ref: 'BBK/0001',
  customerName: 'Jane Doe',
  total: 25000,
  paymentMethod: 'mpesa',
  lines: [{ productId: 'p1', productName: 'Laptop', qty: 1, unitPrice: 25000, serialIds: ['s1'] }],
}

describe('buy-back GL', () => {
  it('builds balanced payout and stock journals', () => {
    const pay = buildBuyBackPayoutLines(sampleBb, 'mpesa')
    assertBuyBackLinesBalanced(pay, sampleBb.ref)
    expect(pay[0].role).toBe('trade_in_clearing')
    expect(pay[1].role).toBe('cash_mobile')
    const stock = buildBuyBackStockLines(sampleBb)
    assertBuyBackLinesBalanced(stock)
    expect(stock[0].role).toBe('inventory')
    expect(buyBackPayoutRef(sampleBb.ref)).toContain('BBK')
  })

  it('registers trade_in_clearing and 4003 roles', () => {
    expect(COA_ROLE_CODES.trade_in_clearing).toBe('1250')
    expect(COA_ROLE_CODES.current_year_pl).toBe('4003')
  })
})

describe('serial COGS', () => {
  it('uses DeviceSerialCost when present', () => {
    const r = resolveSerialCogs({
      qty: 2,
      serialIds: ['a', 'b'],
      serialCosts: [
        { serialId: 'a', currentCost: 1000 },
        { serialId: 'b', currentCost: 1500 },
      ],
      averageCost: 900,
    })
    expect(r.mode).toBe('serial')
    expect(r.totalCost).toBe(2500)
    expect(r.unitCost).toBe(1250)
  })

  it('falls back to average for missing serials', () => {
    const r = resolveSerialCogs({
      qty: 2,
      serialIds: ['a', 'b'],
      serialCosts: [{ serialId: 'a', currentCost: 1000 }],
      averageCost: 800,
    })
    expect(r.mode).toBe('mixed')
    expect(r.totalCost).toBe(1800)
    expect(r.missingSerialIds).toEqual(['b'])
  })
})

describe('OFX/CSV import', () => {
  it('parses CSV and fingerprints lines', () => {
    const csv = 'Date,Amount,Payee,Memo\n2026-08-01,1500.50,Customer A,INV1\n2026-08-02,-200,Vendor,Fee\n'
    const lines = parseBankStatementCsv(csv, 'ncba')
    expect(lines).toHaveLength(2)
    expect(lines[0].amount).toBe(1500.5)
    expect(lines[0].fingerprint).toHaveLength(40)
    expect(detectStatementFormat(csv)).toBe('csv')
  })

  it('parses OFX STMTTRN blocks', () => {
    const ofx = `
OFXHEADER:100
<OFX>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260801
<TRNAMT>1000.00
<FITID>FIT1
<NAME>ACME
<MEMO>Sale
</STMTTRN>
</OFX>`
    expect(detectStatementFormat(ofx)).toBe('ofx')
    const lines = parseBankStatementOfx(ofx, 'absa')
    expect(lines).toHaveLength(1)
    expect(lines[0].fitId).toBe('FIT1')
    expect(lines[0].amount).toBe(1000)
    expect(fingerprintStatementLine({
      bankAccountId: 'absa',
      date: '2026-08-01',
      amount: 1000,
      fitId: 'FIT1',
    })).toHaveLength(40)
  })
})

describe('year-end close + VAT remittance', () => {
  it('closes revenue/expense into 4003', () => {
    const { lines, netProfit } = buildYearEndCloseLines([
      { code: '5000', name: 'Sales', accountType: 'revenue', debit: 0, credit: 100000 },
      { code: '6001', name: 'COGS', accountType: 'expense', debit: 40000, credit: 0 },
      { code: '6401', name: 'Bank Charges', accountType: 'expense', debit: 1000, credit: 0 },
    ], 2025)
    expect(netProfit).toBe(59000)
    expect(lines.some(l => l.accountLabel.includes('4003'))).toBe(true)
    const d = lines.reduce((s, l) => s + l.debit, 0)
    const c = lines.reduce((s, l) => s + l.credit, 0)
    expect(Math.abs(d - c)).toBeLessThan(0.02)
  })

  it('builds VAT remittance settlement', () => {
    const { lines, vatPayable } = buildVatRemittanceLines({
      taxPeriodCode: '2026-Q1',
      outputVat: 16000,
      inputVat: 4000,
      paymentMethod: 'bank_transfer',
    })
    expect(vatPayable).toBe(12000)
    expect(lines.length).toBe(3)
  })
})

describe('analytics + CoA aliases', () => {
  it('distributes analytic amounts to 100%', () => {
    const splits = distributeAnalyticAmount(1000, [
      { analyticAccountId: 'a1', percentage: 60 },
      { analyticAccountId: 'a2', percentage: 40 },
    ])
    expect(splits.map(s => s.amount)).toEqual([600, 400])
    expect(budgetVariance(1000, 800)).toBe(200)
  })

  it('maps display codes without rewriting live codes', () => {
    expect(resolveLiveCode('121000', DEFAULT_COA_ALIASES)).toBe('1800')
    expect(displayCodeFor('1800', DEFAULT_COA_ALIASES)).toBe('121000')
  })
})
