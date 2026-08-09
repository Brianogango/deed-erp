# Margin calculator pricing (from cost)

Port of the Deed **Margins / Calculator** Google Sheet into ERP pricing.

## Formula

```
overheadRate = annualOverhead / annualRevenue
tierReduction = VLOOKUP(buyCost, tiers, approximate)
effectiveMargin = categoryTargetMargin - tierReduction
pricingDivisor = 1 - overheadRate - effectiveMargin
sellExVat = buyCost / pricingDivisor
listPrice = roundUp(sellExVat, roundUpKes)   // default step 500
invoiceIncVat = sellExVat × (1 + vatRate)    // default 16%
```

- **Min band** uses category min target profit  
- **Max band** uses category max target profit  
- Inventory **list/sale** suggestion uses the **rounded max** band (quote down toward min)  
- Sales **special_pricing** floor uses classic GP% = `overheadRate + effectiveMinTarget`

## Where it lives

| Piece | Path |
|-------|------|
| Policy defaults (spreadsheet) | `lib/pricing/margin-policy.ts` |
| Pure calculator | `lib/pricing/margin-calculator.ts` |
| Suggest / legacy bridge | `lib/sale-price-calculator.ts` |
| Settings UI | Settings → Sales → Margin calculator |
| Inventory | Product form + Update sale price (min/max buttons) |
| Confirm gate | `lib/sales/margin-approval.ts` + server enforcement |

## Settings

`systemSettings.pricingMarginPolicy` stores overhead, category bands, tiers, and ERP category → pricing band maps. Reset restores spreadsheet defaults.

Optional per-product override: `product.pricingCategoryId` (also readable from Prisma `specs.pricingCategoryId` on the server).

## Legacy

`invCategorySaleMarkupPct` remains as fallback when the policy is disabled or a category is unmapped.
