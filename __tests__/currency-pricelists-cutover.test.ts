import { describe, expect, it } from 'vitest'
import {
  documentMoneySnapshot,
  findExchangeRate,
  formatMoney,
  FUNCTIONAL_CURRENCY,
  normalizeCurrencyCode,
  toBaseAmount,
} from '@/lib/currency'
import {
  BUILTIN_PRICELISTS,
  needsSpecialPricingApproval,
  normalizePricelistCode,
  resolveListPrice,
} from '@/lib/pricing/pricelist'
import {
  archiveKeyFor,
  canArchive,
  canCertify,
  canRetireLiveKey,
  countBlobArray,
  domainRoleFor,
  evaluateParity,
  summariseParityChecks,
  uncertifiedProtectedKeys,
  BLOB_SOT_KEYS,
} from '@/lib/blob-cutover'

describe('multi-currency KES-first', () => {
  it('keeps functional currency as KES', () => {
    expect(FUNCTIONAL_CURRENCY).toBe('KES')
    expect(normalizeCurrencyCode('usd')).toBe('USD')
    expect(normalizeCurrencyCode('nope')).toBe('KES')
  })

  it('snapshots document money with rate 1 for KES', () => {
    expect(documentMoneySnapshot()).toEqual({
      currencyCode: 'KES',
      baseCurrencyCode: 'KES',
      exchangeRateToBase: 1,
    })
    expect(documentMoneySnapshot({ currencyCode: 'USD', exchangeRateToBase: 130 })).toMatchObject({
      currencyCode: 'USD',
      exchangeRateToBase: 130,
    })
  })

  it('converts to base and formats', () => {
    expect(toBaseAmount(10, 130)).toBe(1300)
    expect(formatMoney(1500, 'KES')).toContain('1,500')
  })

  it('finds latest exchange rate on or before asOf', () => {
    const rates = [
      { id: '1', fromCurrency: 'USD' as const, toCurrency: 'KES' as const, rate: 120, effectiveDate: '2026-01-01' },
      { id: '2', fromCurrency: 'USD' as const, toCurrency: 'KES' as const, rate: 130, effectiveDate: '2026-06-01' },
    ]
    expect(findExchangeRate(rates, 'USD', '2026-03-01')).toBe(120)
    expect(findExchangeRate(rates, 'USD', '2026-07-01')).toBe(130)
    expect(findExchangeRate(rates, 'KES')).toBe(1)
  })
})

describe('pricelist engine', () => {
  const product = {
    id: 'p1',
    salePrice: 10000,
    wholesalePrice: 8500,
    kilimallPrice: 9200,
  }

  it('normalizes codes and resolves retail/wholesale/kilimall', () => {
    expect(normalizePricelistCode('wholesale')).toBe('WHOLESALE')
    expect(resolveListPrice({ product, pricelist: 'RETAIL' }).unitPrice).toBe(10000)
    expect(resolveListPrice({ product, pricelist: 'WHOLESALE' }).unitPrice).toBe(8500)
    expect(resolveListPrice({ product, pricelist: 'KILIMALL' }).unitPrice).toBe(9200)
  })

  it('falls back to retail when channel price missing', () => {
    expect(resolveListPrice({
      product: { id: 'p2', salePrice: 5000 },
      pricelist: 'WHOLESALE',
    }).unitPrice).toBe(5000)
  })

  it('flags special pricing when custom undercuts list without discount %', () => {
    const priced = resolveListPrice({ product, pricelist: 'RETAIL', customPrice: 8000 })
    expect(priced.belowList).toBe(true)
    expect(needsSpecialPricingApproval(priced, 0)).toBe(true)
    expect(needsSpecialPricingApproval(priced, 15)).toBe(false)
  })

  it('uses fixed item override when present', () => {
    const lists = BUILTIN_PRICELISTS
    const retail = lists.find(l => l.code === 'RETAIL')!
    const priced = resolveListPrice({
      product,
      pricelist: 'RETAIL',
      priceLists: lists,
      priceListItems: [{
        id: 'i1',
        priceListId: retail.id,
        productId: 'p1',
        unitPrice: 7777,
        minimumQty: 1,
        maximumDiscount: 0,
        active: true,
      }],
    })
    expect(priced.unitPrice).toBe(7777)
    expect(priced.usedItemOverride).toBe(true)
  })
})

describe('blob cutover gates', () => {
  it('counts JSON arrays and evaluates parity', () => {
    expect(countBlobArray(JSON.stringify([{ a: 1 }, { a: 2 }]))).toBe(2)
    expect(evaluateParity({
      blobKey: 'deed_accounts',
      prismaTable: 'account_codes',
      blobCount: 10,
      prismaCount: 10,
    }).parityOk).toBe(true)
  })

  it('hard-stops products mismatch', () => {
    const check = evaluateParity({
      blobKey: 'deed_products',
      prismaTable: 'products',
      blobCount: 429,
      prismaCount: 420,
      hardStopWhenUnequal: true,
    })
    expect(check.parityOk).toBe(false)
    expect(check.blockedReason).toMatch(/Hard stop/)
    expect(canCertify(check)).toBe(false)
  })

  it('tracks blob-SoT lag without treating it as certify-ready', () => {
    const check = evaluateParity({
      blobKey: 'deed_serials',
      prismaTable: 'serial_numbers',
      blobCount: 200,
      prismaCount: 15,
      domainRole: 'blob_sot',
    })
    expect(check.parityOk).toBe(false)
    expect(check.mirrorCoverage).toBeCloseTo(0.075)
    expect(check.details?.tracked).toBe(true)
    expect(canCertify(check)).toBe(false)
  })

  it('flags Prisma ahead of blob-SoT as unhealthy', () => {
    const check = evaluateParity({
      blobKey: 'deed_serials',
      prismaTable: 'serial_numbers',
      blobCount: 10,
      prismaCount: 12,
      domainRole: 'blob_sot',
    })
    expect(check.parityOk).toBe(false)
    expect(check.blockedReason).toMatch(/Prisma ahead/)
  })

  it('summarises hard-stops vs blob-SoT lag for cron exit codes', () => {
    const summary = summariseParityChecks([
      evaluateParity({ blobKey: 'deed_products', prismaTable: 'products', blobCount: 10, prismaCount: 9, domainRole: 'catalog' }),
      evaluateParity({ blobKey: 'deed_serials', prismaTable: 'serial_numbers', blobCount: 10, prismaCount: 2, domainRole: 'blob_sot' }),
      evaluateParity({ blobKey: 'deed_quotes', prismaTable: 'quotes', blobCount: 5, prismaCount: 5, domainRole: 'dual_write' }),
    ])
    expect(summary.hardStops).toBe(1)
    expect(summary.blobSotLag).toBe(1)
    expect(summary.dualWriteGaps).toBe(0)
    expect(summary.unhealthy).toBe(true)
  })

  it('requires certify before archive and archive before retire', () => {
    expect(canArchive({ status: 'verified', parityOk: true })).toBe(false)
    expect(canArchive({ status: 'certified', parityOk: true })).toBe(true)
    expect(canRetireLiveKey({ status: 'certified', parityOk: true, archiveKey: 'x' })).toBe(false)
    expect(canRetireLiveKey({ status: 'archived', parityOk: true, archiveKey: 'archive:deed_accounts:t' })).toBe(true)
    expect(archiveKeyFor('deed_accounts', new Date('2026-07-31T00:00:00.000Z'))).toContain('archive:deed_accounts:')
  })

  it('lists uncertified protected keys for reset gate', () => {
    expect(uncertifiedProtectedKeys([
      { blobKey: 'deed_accounts', status: 'certified', parityOk: true },
    ], ['deed_accounts', 'deed_products'])).toEqual(['deed_products'])
  })

  it('treats former blob-SoT collections as dual-write after Prisma transfer', () => {
    expect(BLOB_SOT_KEYS).toEqual([])
    expect(domainRoleFor('deed_serials')).toBe('dual_write')
    expect(domainRoleFor('deed_purchaseOrders')).toBe('dual_write')
    expect(domainRoleFor('deed_stockMoves')).toBe('dual_write')
    expect(domainRoleFor('deed_deliveries')).toBe('dual_write')
    expect(domainRoleFor('deed_receipts')).toBe('dual_write')
  })
})
