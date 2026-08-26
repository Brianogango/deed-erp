# Company Property

Office furniture, fittings, and non-trading equipment. Staff laptops and phones issued from **trading stock** stay on **HR → Assets**.

## v1 (shipped)

Register only: record, move, custodian, status, dispose, write-off. Compare capital cost to COA **1701–1703**. **Does not** post journals or depreciation.

## Phase 2 — not now

Do not implement until requested. Chart of accounts already exists.

| Item | Accounts / behaviour |
|---|---|
| Monthly depreciation | Dr **6517** Depreciation and Amortization / Cr **175x** Accumulated Depreciation (1751 computers, 1752 furniture, 1753 office equipment, 1754 software). Needs useful life, residual, method per asset. |
| Capitalise from vendor bill / PO | Post to PPE **170x**, not inventory **1200**. |
| Dispose with proceeds | Dr cash/bank + accum. depr. **175x**; Cr cost **170x**; plug P&L to **5203** (profit) or **6515** (loss). Clear cost and accumulated depreciation. |
| KRA capital allowances | Tax written-down value vs book depreciation — two tracks, do not mix. |
| Print asset tags / barcode | Physical labels from `assetTag`. |
| Link a trading serial | If a demo / floor unit is capitalised off inventory, point this register row at that serial so it leaves stock. |
| Optional: under repair | Office equipment **Under repair** may open a Repair job. |

v1 dispose/write-off stay register-only until this phase posts the journals.
