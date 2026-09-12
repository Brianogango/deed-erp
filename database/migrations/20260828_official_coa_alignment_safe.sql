-- Align the live Chart of Accounts with the official DEED TECHNOLOGIES LTD
-- chart (Jan–Dec 2025): Import Purchases own 6201-6213, employment expenses
-- own 6601-6608, financial expenses own 6701-6705, statutory liabilities own
-- 3302-3304, and the operating-expense block is 6501-6521.
--
-- Renumbering is FK-safe: journal_entry_lines reference account_id, so
-- history follows the row to its new code. Zero-journal accounts created by
-- 20260828_coa_alignment_safe.sql that collide with the official meaning
-- (6400/6410/6415/6420/6440/6450, 6102 'Services Purchases') are removed,
-- guarded by NOT EXISTS on journal lines.
--
-- No deletes of posted accounts, no balance changes. Safe to re-run:
-- each dest-code UPDATE is a no-op when that official code already exists
-- (production already applied this alignment; a second deploy must not
-- collide on account_codes_code_key).

BEGIN;

-- ── 0. Drop today's zero-line accounts whose codes the official chart owns ───
DELETE FROM account_codes a
WHERE a.code IN ('6400', '6410', '6415', '6420', '6440', '6450', '6102')
  AND NOT EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.account_id = a.id);

-- ── 1. Renumber existing accounts onto official codes ────────────────────────
-- Payroll employment expenses → 66xx (6201-6213 become Import Purchases).
UPDATE account_codes SET code = '6601', name = 'Salaries', account_group = 'Employment Expenses', sub_group = 'Employment Expenses', updated_at = CURRENT_TIMESTAMP WHERE code = '6201' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '6601');
UPDATE account_codes SET code = '6606', name = 'Contribution to Pension Fund (NSSF)', account_group = 'Employment Expenses', sub_group = 'Employment Expenses', updated_at = CURRENT_TIMESTAMP WHERE code = '6202' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '6606');
UPDATE account_codes SET code = '6609', name = 'Affordable Housing Levy (Employer)', account_group = 'Employment Expenses', sub_group = 'Employment Expenses', updated_at = CURRENT_TIMESTAMP WHERE code = '6203' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '6609');
-- Inventory variance accounts → direct-cost extensions (62xx is Import Purchases).
UPDATE account_codes SET code = '6305', name = 'Inventory Adjustment', account_group = 'Direct Expenses', sub_group = 'Inventory', updated_at = CURRENT_TIMESTAMP WHERE code = '6200' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '6305');
UPDATE account_codes SET code = '6306', name = 'Inventory Write-off', account_group = 'Direct Expenses', sub_group = 'Inventory', updated_at = CURRENT_TIMESTAMP WHERE code = '6205' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '6306');
UPDATE account_codes SET code = '6307', name = 'Purchase Price Difference', account_group = 'Direct Expenses', sub_group = 'Inventory', updated_at = CURRENT_TIMESTAMP WHERE code = '6210' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '6307');
-- Bank charges → financial expenses (6401 becomes Selling and Delivery).
UPDATE account_codes SET code = '6703', name = 'Bank Charges', account_group = 'Financial Expenses', sub_group = 'Financial Expenses', updated_at = CURRENT_TIMESTAMP WHERE code = '6401' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '6703');
-- Operating expenses onto the official 65xx block.
UPDATE account_codes SET code = '6518', name = 'Office Expenses', account_group = 'Operating Expenses', sub_group = 'Operating and Administrative', updated_at = CURRENT_TIMESTAMP WHERE code = '6405' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '6518');
UPDATE account_codes SET code = '6511', name = 'Subsistence and Accommodation', account_group = 'Operating Expenses', sub_group = 'Operating and Administrative', updated_at = CURRENT_TIMESTAMP WHERE code = '6430' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '6511');
UPDATE account_codes SET code = '6595', name = 'Cash Over/Short', account_group = 'Operating Expenses', sub_group = 'Operating and Administrative', updated_at = CURRENT_TIMESTAMP WHERE code = '6495' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '6595');
UPDATE account_codes SET code = '6599', name = 'Other Operating Expenses', account_group = 'Operating Expenses', sub_group = 'Operating and Administrative', updated_at = CURRENT_TIMESTAMP WHERE code = '6499' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '6599');
-- Statutory liabilities onto official 3302-3304, then payroll extensions.
UPDATE account_codes SET code = '3302', name = 'PAYE Payable', updated_at = CURRENT_TIMESTAMP WHERE code = '3305' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '3302');
UPDATE account_codes SET code = '3303', name = 'NSSF Payable', updated_at = CURRENT_TIMESTAMP WHERE code = '3306' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '3303');
UPDATE account_codes SET code = '3304', name = 'NHIF / SHIF Payable', updated_at = CURRENT_TIMESTAMP WHERE code = '3307' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '3304');
UPDATE account_codes SET code = '3305', name = 'Affordable Housing Levy Payable', updated_at = CURRENT_TIMESTAMP WHERE code = '3308' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '3305');
UPDATE account_codes SET code = '3306', name = 'Pension Payable', updated_at = CURRENT_TIMESTAMP WHERE code = '3309' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '3306');
-- Payroll/credit clearing accounts out of the official payables grid.
UPDATE account_codes SET code = '3310', name = 'Net Payroll Payable', updated_at = CURRENT_TIMESTAMP WHERE code = '3110' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '3310');
UPDATE account_codes SET code = '3312', name = 'Employee Reimbursements Payable', account_type = 'liability', updated_at = CURRENT_TIMESTAMP WHERE code = '3105' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '3312');
UPDATE account_codes SET code = '3313', name = 'Customer Credits', updated_at = CURRENT_TIMESTAMP WHERE code = '3102' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '3313');
UPDATE account_codes SET code = '3202', name = 'Outstanding Payments', updated_at = CURRENT_TIMESTAMP WHERE code = '3005' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '3202');
-- Receivables clearing out of the official product grid; advances onto 1931.
UPDATE account_codes SET code = '1933', name = 'Outstanding Receipts', account_group = 'Receivables - Other', sub_group = 'Other Debtors', updated_at = CURRENT_TIMESTAMP WHERE code = '1805' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '1933');
UPDATE account_codes SET code = '1931', name = 'Employee Salary Advances', account_group = 'Receivables - Other', sub_group = 'Other Debtors', updated_at = CURRENT_TIMESTAMP WHERE code = '1810' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '1931');
-- Services revenue onto the solutions block; interest onto other income.
UPDATE account_codes SET code = '5101', name = 'On-Demand IT', account_group = 'Revenue - Services', sub_group = 'Solutions and Services', updated_at = CURRENT_TIMESTAMP WHERE code = '5003' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '5101');
UPDATE account_codes SET code = '5201', name = 'Dividends and Interest', account_group = 'Other Income', sub_group = 'Other Income', updated_at = CURRENT_TIMESTAMP WHERE code = '5105' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '5201');
-- Trade-in out of 6108 (official: Local Purchases — Printers).
UPDATE account_codes SET code = '6114', name = 'Trade-in Purchases', account_group = 'Local Purchases', sub_group = 'Trade-in', updated_at = CURRENT_TIMESTAMP WHERE code = '6108' AND NOT EXISTS (SELECT 1 FROM account_codes WHERE code = '6114');

-- ── 2. Official names on retained rows ───────────────────────────────────────
UPDATE account_codes SET name = 'Laptops', updated_at = CURRENT_TIMESTAMP WHERE code = '5001';
UPDATE account_codes SET name = 'Accessories', updated_at = CURRENT_TIMESTAMP WHERE code = '5002';
UPDATE account_codes SET name = 'Laptops', account_group = 'Local Purchases', sub_group = 'Local Purchases', updated_at = CURRENT_TIMESTAMP WHERE code = '6101';

-- ── 3. Official accounts that were missing ───────────────────────────────────
INSERT INTO account_codes (
  id, code, name, account_type, account_group, sub_group,
  is_active, is_dynamic, balance, notes, created_at, updated_at
)
SELECT gen_random_uuid(), v.code, v.name, v.account_type, v.account_group, v.sub_group,
       true, false, 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  VALUES
    -- PPE / intangibles
    ('1705', 'Goodwill', 'asset', 'PPE - Cost', 'Cost'),
    -- Non-current liabilities
    ('3401', 'Bank Loan', 'liability', 'Non-Current Liabilities', 'Non-Current Liabilities'),
    ('3402', 'Directors Account', 'liability', 'Non-Current Liabilities', 'Non-Current Liabilities'),
    -- Revenue — product grid (5001/5002 retained)
    ('5003', 'Desktop / Combo', 'revenue', 'Revenue - Products', 'Product'),
    ('5004', 'Complete Desktops', 'revenue', 'Revenue - Products', 'Product'),
    ('5005', 'Monitors', 'revenue', 'Revenue - Products', 'Product'),
    ('5006', 'Servers', 'revenue', 'Revenue - Products', 'Product'),
    ('5007', 'Power Backup Solutions', 'revenue', 'Revenue - Products', 'Product'),
    ('5008', 'Printers', 'revenue', 'Revenue - Products', 'Product'),
    ('5009', 'Software Licenses', 'revenue', 'Revenue - Products', 'Product'),
    ('5010', 'Parts and Components', 'revenue', 'Revenue - Products', 'Product'),
    ('5011', 'Printer Consumables', 'revenue', 'Revenue - Products', 'Product'),
    ('5012', 'Networking Equipment', 'revenue', 'Revenue - Products', 'Product'),
    ('5013', 'Consumer Electronics', 'revenue', 'Revenue - Products', 'Product'),
    -- Revenue — solutions & repair
    ('5102', 'IT Consultancy', 'revenue', 'Revenue - Services', 'Solutions and Services'),
    ('5103', 'Managed IT Infrastructure', 'revenue', 'Revenue - Services', 'Solutions and Services'),
    ('5104', 'Server Administration', 'revenue', 'Revenue - Services', 'Solutions and Services'),
    ('5105', 'Cloud Solutions', 'revenue', 'Revenue - Services', 'Solutions and Services'),
    ('5106', 'Data Backup', 'revenue', 'Revenue - Services', 'Solutions and Services'),
    ('5107', 'Data Recovery', 'revenue', 'Revenue - Services', 'Solutions and Services'),
    ('5108', 'Power Backup', 'revenue', 'Revenue - Services', 'Solutions and Services'),
    ('5109', 'Enterprise OEM Software Services', 'revenue', 'Revenue - Services', 'Solutions and Services'),
    ('5110', 'Security Solutions', 'revenue', 'Revenue - Services', 'Solutions and Services'),
    ('5121', 'Hardware Support', 'revenue', 'Revenue - Services', 'Expert Repair Services'),
    ('5122', 'Software Support', 'revenue', 'Revenue - Services', 'Expert Repair Services'),
    -- Other income (5201 from 5105; 5200/5203/5206 already present)
    ('5202', 'Commission', 'revenue', 'Other Income', 'Other Income'),
    ('5204', 'Bad Debts Recovered', 'revenue', 'Other Income', 'Other Income'),
    ('5205', 'Discount Received', 'revenue', 'Other Income', 'Other Income'),
    -- Local purchases product grid (6101 retained, 6114 = trade-in)
    ('6102', 'Accessories', 'expense', 'Local Purchases', 'Local Purchases'),
    ('6103', 'Desktops', 'expense', 'Local Purchases', 'Local Purchases'),
    ('6104', 'Complete Desktops', 'expense', 'Local Purchases', 'Local Purchases'),
    ('6105', 'Monitors', 'expense', 'Local Purchases', 'Local Purchases'),
    ('6106', 'Servers', 'expense', 'Local Purchases', 'Local Purchases'),
    ('6107', 'Power Backup Solutions', 'expense', 'Local Purchases', 'Local Purchases'),
    ('6108', 'Printers', 'expense', 'Local Purchases', 'Local Purchases'),
    ('6109', 'Software Licenses', 'expense', 'Local Purchases', 'Local Purchases'),
    ('6110', 'Parts and Components', 'expense', 'Local Purchases', 'Local Purchases'),
    ('6111', 'Printer Consumables', 'expense', 'Local Purchases', 'Local Purchases'),
    ('6112', 'Networking Equipment', 'expense', 'Local Purchases', 'Local Purchases'),
    ('6113', 'Consumer Electronics', 'expense', 'Local Purchases', 'Local Purchases'),
    -- Import purchases product grid
    ('6201', 'Laptops (Import)', 'expense', 'Import Purchases', 'Import Purchases'),
    ('6202', 'Accessories (Import)', 'expense', 'Import Purchases', 'Import Purchases'),
    ('6203', 'Desktops (Import)', 'expense', 'Import Purchases', 'Import Purchases'),
    ('6204', 'Complete Desktops (Import)', 'expense', 'Import Purchases', 'Import Purchases'),
    ('6205', 'Monitors (Import)', 'expense', 'Import Purchases', 'Import Purchases'),
    ('6206', 'Servers (Import)', 'expense', 'Import Purchases', 'Import Purchases'),
    ('6207', 'Power Backup Solutions (Import)', 'expense', 'Import Purchases', 'Import Purchases'),
    ('6208', 'Printers (Import)', 'expense', 'Import Purchases', 'Import Purchases'),
    ('6209', 'Software Licenses (Import)', 'expense', 'Import Purchases', 'Import Purchases'),
    ('6210', 'Parts and Components (Import)', 'expense', 'Import Purchases', 'Import Purchases'),
    ('6211', 'Printer Consumables (Import)', 'expense', 'Import Purchases', 'Import Purchases'),
    ('6212', 'Networking Equipment (Import)', 'expense', 'Import Purchases', 'Import Purchases'),
    ('6213', 'Consumer Electronics (Import)', 'expense', 'Import Purchases', 'Import Purchases'),
    -- Direct expenses (6305-6307 = inventory variance family)
    ('6301', 'Solutions and Expert Repair Services'' Costs', 'expense', 'Direct Expenses', 'Direct Expenses'),
    ('6302', 'Direct Salaries', 'expense', 'Direct Expenses', 'Direct Expenses'),
    ('6303', 'Direct Wages', 'expense', 'Direct Expenses', 'Direct Expenses'),
    ('6304', 'Direct Commission', 'expense', 'Direct Expenses', 'Direct Expenses'),
    -- Other direct expenses
    ('6401', 'Selling and Delivery', 'expense', 'Other Direct Expenses', 'Other Direct Expenses'),
    ('6402', 'Packaging Expenses', 'expense', 'Other Direct Expenses', 'Other Direct Expenses'),
    -- Operating & administrative expenses
    ('6501', 'Advertisement and Promotion', 'expense', 'Operating Expenses', 'Operating and Administrative'),
    ('6502', 'Auditors Remuneration', 'expense', 'Operating Expenses', 'Operating and Administrative'),
    ('6503', 'Computer Expenses', 'expense', 'Operating Expenses', 'Operating and Administrative'),
    ('6504', 'Printing and Stationery', 'expense', 'Operating Expenses', 'Operating and Administrative'),
    ('6505', 'Repairs and Maintenance', 'expense', 'Operating Expenses', 'Operating and Administrative'),
    ('6506', 'Water and Electricity', 'expense', 'Operating Expenses', 'Operating and Administrative'),
    ('6507', 'Fuel and Transport', 'expense', 'Operating Expenses', 'Operating and Administrative'),
    ('6508', 'Rent and Service Charge', 'expense', 'Operating Expenses', 'Operating and Administrative'),
    ('6509', 'Legal Expenses', 'expense', 'Operating Expenses', 'Operating and Administrative'),
    ('6510', 'Telephone and Internet', 'expense', 'Operating Expenses', 'Operating and Administrative'),
    ('6512', 'Bad Debts Written Off', 'expense', 'Operating Expenses', 'Operating and Administrative'),
    ('6513', 'Provision for Bad and Doubtful Debts', 'expense', 'Operating Expenses', 'Operating and Administrative'),
    ('6514', 'Gifts and Donations', 'expense', 'Operating Expenses', 'Operating and Administrative'),
    ('6516', 'Management Fees', 'expense', 'Operating Expenses', 'Operating and Administrative'),
    ('6519', 'Courier and Delivery', 'expense', 'Operating Expenses', 'Operating and Administrative'),
    ('6520', 'Discount Allowed', 'expense', 'Operating Expenses', 'Operating and Administrative'),
    -- Employment expenses (6601/6606/6609 renumbered in)
    ('6602', 'Wages', 'expense', 'Employment Expenses', 'Employment Expenses'),
    ('6603', 'Commission', 'expense', 'Employment Expenses', 'Employment Expenses'),
    ('6604', 'Staff Bonus', 'expense', 'Employment Expenses', 'Employment Expenses'),
    ('6605', 'Training Expenses', 'expense', 'Employment Expenses', 'Employment Expenses'),
    ('6607', 'Leave Encashment', 'expense', 'Employment Expenses', 'Employment Expenses'),
    ('6608', 'Any Other Employment Costs', 'expense', 'Employment Expenses', 'Employment Expenses'),
    -- Financial expenses (6703 renumbered in; 6705 already present)
    ('6701', 'Interest Expense', 'expense', 'Financial Expenses', 'Financial Expenses'),
    ('6702', 'Commitment Fees', 'expense', 'Financial Expenses', 'Financial Expenses'),
    ('6704', 'Insurance', 'expense', 'Financial Expenses', 'Financial Expenses')
) AS v(code, name, account_type, account_group, sub_group)
WHERE NOT EXISTS (
  SELECT 1 FROM account_codes a WHERE a.code = v.code
);

COMMIT;
