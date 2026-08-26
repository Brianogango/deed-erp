# Company Property

Office furniture, fittings, and non-trading equipment. Staff laptops and phones issued from **trading stock** stay on **HR → Assets**.

## Register

Record, move, custodian, status, dispose, write-off. Compare capital cost to COA **1701–1704**. Write: Director / Admin Officer. Read: + Finance Officer. Finance (and Admin / Director) can run monthly depreciation.

## Journals (Phase 2)

| Event | Accounts |
|---|---|
| Capitalise purchase (no vendor bill) | Dr **170x** / Cr **3000** AP. Idempotent ref `JRN/AST-CAP/<AST ref>`. |
| Capitalise demo serial | Dr **170x** / Cr **1200** inventory. Serial status becomes `capitalised` (leaves sellable stock). |
| Vendor bill / credit with PPE account | Line account **1701–1704** posts to that cost account — **never 1200**. The register does not post a second capitalise journal when `billRef` is set. |
| Opening / donation | Register only. Do **not** post again — seed balances already sit on 1701–1703. |
| Monthly depreciation | One journal per period: Dr **6517** / Cr **175x** (`JRN/AST-DEP/YYYY-MM`). Furniture/fittings 96 months straight line; office equipment 60 months SL; IT 36 months reducing balance. Residual stops the charge. |
| Dispose / write-off | Dr cash (if proceeds) + accum. depr. **175x**; Cr cost **170x**; plug P&L to **5203** gain or **6515** loss. |

Book depreciation and **KRA capital allowances** are two tracks. Tax WDV uses Class II 30% (computers / software 1701, 1704) and Class IV 12.5% (furniture / office 1702, 1703), reducing balance, once per calendar year. Tax WDV is **never** posted to 6517 / 175x.

## Labels, serials, repair

- **Print tag** — CODE128 of `assetTag` (or `ref` if the tag is blank).
- **Link trading serial** — capitalise a floor / demo unit off inventory.
- **Under repair** — optional Repair job (default on for office equipment). Needs a customer contact named like the company.

## Chart

Cost **1701** computers, **1702** furniture & fittings, **1703** office equipment, **1704** software. Accumulated depreciation **1751–1754**. Expense **6517**. Disposal **5203** / **6515**.
