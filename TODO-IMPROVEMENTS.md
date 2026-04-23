# Deed ERP Improvements TODO
Generated from analysis. Complete all steps for production-ready ERP.

## Phase 1: Store Fixes (Critical - Stock/Workflow)
- [x] 1. Add stock reservation/delivery/approval functions to lib/store.tsx (use code from SALES_IMPLEMENTATION_COMPLETE.md)
  Analyzed file - functions at end; impl next.
- [x] 2. Update convertQuoteToSaleOrder() to call reserveStock()
  Added so.lines.forEach(reserveStock(...)) post-SO creation.
- [x] 3. Wire Sales.tsx to confirmDeliveryWithStockDeduction() (Delivery.tsx is rider jobs)
- [ ] Test: Full flow Quote→SO→Reserve→Deliver→Stock deduct

## Phase 2: Backend/DB
- [ ] 4. npm i @prisma/client @upstash/ratelimit @upstash/redis
- [ ] 5. npx prisma db push && generate
- [ ] 6. Create app/api/products/route.ts etc. (fetch from DB)
- [ ] 7. Refactor modules to use API (SWR/fetch)

## Phase 3: UX/Prod (TODO-UX.md + PROD)
- [ ] 8. shadcn-ui init + migrate ui/
- [ ] 9. Mobile sidebar drawer
- [ ] 10. Upstash rate-limit in middleware
- [ ] 11. Update README.md + test PWA/offline
- [ ] 12. npm run build && vercel --prod

**Progress: 3/12**
**Updated after each step.**
