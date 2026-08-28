-- CoA alignment after accounting hardening audit.
--
-- 1. TYPE CORRECTIONS: many live account_codes rows carry account_type 'asset'
--    although they are liabilities / revenue / expense. Reports
--    (lib/accounting/gl-reports.ts, management-pl.ts) bucket strictly by
--    account_type, so the P&L and balance sheet are wrong until fixed.
--    Journal posting itself never checks type, so no journal entry changes.
-- 2. NAME CORRECTIONS where the name is just the code (1200, 5001, 5002, 5003,
--    6001) — cosmetic, improves CoA/GL readability.
-- 3. MISSING ACCOUNTS used by posting paths but never seeded:
--    PPE 1701-1704 + accumulated depreciation 1751-1754, disposal gain/loss
--    5203/6515, depreciation expense 6517, FX 5206/6705, sales returns 5099,
--    services purchases 6102, expense categories 6400/6410/6415/6420/6440/6450,
--    expensed assets 6521, opening balance equity 4004, equity 4001-4003.
-- 4. MISSING JOURNAL BOOK 'MISC' used by expense / FX / fixed-asset posting.
--
-- UPDATEs and INSERT-if-missing only. No deletes, no renumbering, balances
-- untouched. Safe to re-run.

BEGIN;

-- ── 1+2. Type and name corrections ───────────────────────────────────────────
UPDATE account_codes SET account_type = 'liability', updated_at = CURRENT_TIMESTAMP WHERE code = '3000';
UPDATE account_codes SET account_type = 'liability', updated_at = CURRENT_TIMESTAMP WHERE code = '3100';
UPDATE account_codes SET account_type = 'liability', updated_at = CURRENT_TIMESTAMP WHERE code = '3105';
UPDATE account_codes SET account_type = 'liability', updated_at = CURRENT_TIMESTAMP WHERE code = '3201';
UPDATE account_codes SET account_type = 'liability', updated_at = CURRENT_TIMESTAMP WHERE code = '3301';
UPDATE account_codes SET account_type = 'revenue',   updated_at = CURRENT_TIMESTAMP WHERE code IN ('5000', '5001', '5002', '5003');
UPDATE account_codes SET account_type = 'expense',   updated_at = CURRENT_TIMESTAMP WHERE code IN ('6001', '6101', '6405', '6430', '6495', '6499');

UPDATE account_codes SET name = 'Inventory',               updated_at = CURRENT_TIMESTAMP WHERE code = '1200' AND name = '1200';
UPDATE account_codes SET name = 'Sales — Laptops & Hardware', updated_at = CURRENT_TIMESTAMP WHERE code = '5001' AND name = '5001';
UPDATE account_codes SET name = 'Sales — Parts & Accessories', updated_at = CURRENT_TIMESTAMP WHERE code = '5002' AND name = '5002';
UPDATE account_codes SET name = 'Sales — Services & Software', updated_at = CURRENT_TIMESTAMP WHERE code = '5003' AND name = '5003';
UPDATE account_codes SET name = 'Cost of Goods Sold',      updated_at = CURRENT_TIMESTAMP WHERE code = '6001' AND name = '6001';

-- ── 3. Missing accounts used by posting paths ────────────────────────────────
INSERT INTO account_codes (
  id, code, name, account_type, account_group, sub_group,
  is_active, is_dynamic, dynamic_key, balance, notes, created_at, updated_at
)
SELECT gen_random_uuid(), v.code, v.name, v.account_type, v.account_group, v.sub_group,
       true, v.is_dynamic, v.dynamic_key, 0, v.notes, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  VALUES
    ('1701', 'Computer & Accessories', 'asset', 'PPE - Cost', 'Cost', false, NULL::text, 'Company property — computers & accessories at cost'),
    ('1702', 'Furniture & Fittings', 'asset', 'PPE - Cost', 'Cost', false, NULL, 'Company property — furniture & fittings at cost'),
    ('1703', 'Office Equipment', 'asset', 'PPE - Cost', 'Cost', false, NULL, 'Company property — office equipment at cost'),
    ('1704', 'Software', 'asset', 'PPE - Cost', 'Cost', false, NULL, 'Company property — software at cost'),
    ('1751', 'Accum. Depr. Computer & Accessories', 'asset', 'Accumulated Depreciation', 'Accum. Depr.', false, NULL, 'Contra asset'),
    ('1752', 'Accum. Depr. Furniture & Fittings', 'asset', 'Accumulated Depreciation', 'Accum. Depr.', false, NULL, 'Contra asset'),
    ('1753', 'Accum. Depr. Office Equipment', 'asset', 'Accumulated Depreciation', 'Accum. Depr.', false, NULL, 'Contra asset'),
    ('1754', 'Accum. Depr. Software', 'asset', 'Accumulated Depreciation', 'Accum. Depr.', false, NULL, 'Contra asset'),
    ('4001', 'Share Capital', 'equity', 'Equity', 'Equity', false, NULL, NULL),
    ('4002', 'Retained Earnings', 'equity', 'Equity', 'Equity', false, NULL, NULL),
    ('4003', 'Current Year P&L', 'equity', 'Equity', 'Equity', true, 'net_profit', 'Computed from P&L statement'),
    ('4004', 'Opening Balance Equity', 'equity', 'Equity', 'Equity', false, NULL, 'Offsetting account for opening stock and opening balances'),
    ('5099', 'Sales Returns & Refunds', 'revenue', 'Revenue - Products', 'Product', false, NULL, 'Contra revenue — debit entries reduce revenue'),
    ('5203', 'Profit / Surplus on Disposal of Assets', 'revenue', 'Other Income', 'Other Income', false, NULL, NULL),
    ('5206', 'Realized Exchange Gain', 'revenue', 'Other Income', 'Finance', false, NULL, NULL),
    ('6102', 'Services Purchases', 'expense', 'Local Purchases', 'Local Purchases', false, NULL, 'Cost account for service-kind products'),
    ('6400', 'Transport & Fuel', 'expense', 'Operating Expenses', 'Operating and Administrative', false, NULL, NULL),
    ('6410', 'Printing & Stationery', 'expense', 'Operating Expenses', 'Operating and Administrative', false, NULL, NULL),
    ('6415', 'Utilities', 'expense', 'Operating Expenses', 'Operating and Administrative', false, NULL, 'Water / electricity and other utilities'),
    ('6420', 'Courier & Delivery', 'expense', 'Operating Expenses', 'Operating and Administrative', false, NULL, NULL),
    ('6440', 'Software & Subscriptions', 'expense', 'Operating Expenses', 'Operating and Administrative', false, NULL, NULL),
    ('6450', 'Maintenance & Repairs', 'expense', 'Operating Expenses', 'Operating and Administrative', false, NULL, NULL),
    ('6515', 'Loss on Disposal of Assets', 'expense', 'Operating Expenses', 'Operating and Administrative', false, NULL, NULL),
    ('6517', 'Depreciation and Amortization', 'expense', 'Operating Expenses', 'Operating and Administrative', false, NULL, NULL),
    ('6521', 'Expensed Assets', 'expense', 'Operating Expenses', 'Operating and Administrative', false, NULL, 'Equipment/hardware purchases expensed rather than capitalized'),
    ('6705', 'Realized and Unrealized Exchange Loss', 'expense', 'Financial Expenses', 'Financial Expenses', false, NULL, NULL)
) AS v(code, name, account_type, account_group, sub_group, is_dynamic, dynamic_key, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM account_codes a WHERE a.code = v.code
);

-- ── 4. Miscellaneous journal book used by expense / FX / fixed-asset posting ─
INSERT INTO journals (id, code, name, journal_type, is_active, created_at)
SELECT gen_random_uuid(), 'MISC', 'Miscellaneous', 'general', true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM journals j WHERE j.code = 'MISC');

COMMIT;
