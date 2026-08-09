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

## Spreadsheet coverage

| Spreadsheet | ERP |
|-------------|-----|
| Margins: overhead revenue/overhead/rate | Settings policy fields |
| Margins: 13 category min/max bands | `pricingMarginPolicy.categories` |
| Margins: 8 price tier reductions | `pricingMarginPolicy.tiers` |
| Calculator Step 1 category + targets | Settings → interactive Margin calculator |
| Calculator Step 2 buy cost + tier | Same tool (auto VLOOKUP) |
| Calculator Step 3 effective margin, divisor, sell ex VAT, invoice inc VAT | Same tool + Inventory/Sales bands |
| Round up by KES 500 | `roundUpKes` on sell suggestion |
| Brand New vs Refurb | `productType` new → Brand New PCs; refurbished → refurb bands |

## Where it lives

| Piece | Path |
|-------|------|
| Policy defaults (spreadsheet) | `lib/pricing/margin-policy.ts` |
| Pure calculator | `lib/pricing/margin-calculator.ts` |
| Suggest / legacy bridge | `lib/sale-price-calculator.ts` |
| Interactive Calculator UI | Settings → Sales → Margin calculator tool |
| Policy editor | Settings → Sales (bands, tiers, maps) |
| Inventory | Condition + pricing band + min/max + invoice preview |
| Sales | Add-product quote band from cost |
| Confirm gate | `lib/sales/margin-approval.ts` + server enforcement |

## Settings

`systemSettings.pricingMarginPolicy` stores overhead, category bands, tiers, and ERP category → pricing band maps. Reset restores spreadsheet defaults.

Optional per-product override: `product.pricingCategoryId` stored in Prisma `specs.pricingCategoryId`. Condition is Prisma `product.productType` (`new` | `refurbished`; create defaults to **refurbished** so Laptops/Desktops map to refurb bands, not Brand New PCs).

## Persistence & sync

| Surface | Behaviour |
|---------|-----------|
| Product create / bulk | Writes `productType` + `specs.pricingCategoryId` (+ kind/unit/tax) |
| Product PATCH | Merges specs; when **cost** changes without an explicit sale, recalculates list from policy |
| Catalog merge (`GET /api/products`) | Hydrates `productType`, `pricingCategoryId`, `productKind` into the client store |
| GRN / stock receipt | Updates `product.costPrice` to new average and refreshes list from policy |
| Services | Skipped by margin suggest (manual sale); Inventory hides Condition / Pricing band |
| Reconfiguration `cost_plus` | Recommended sell = margin-policy list (fallback 25% markup) |

## Legacy

`invCategorySaleMarkupPct` remains as fallback when the policy is disabled or a category is unmapped.
