-- Unblock operations after accounting fail-closed posting:
--   1. Reconfiguration snapshots overflowed display_name varchar(300)
--      (Lenovo/HP catalog titles are 300–500+ characters).
--   2. Perpetual inventory posting requires CoA 6200 / 6205 / 6210 which
--      were never seeded (62xx on live is payroll 6201–6203).
-- Additive and non-destructive. Safe to re-run.

BEGIN;

ALTER TABLE device_configuration_snapshots
  ALTER COLUMN display_name TYPE varchar(1000);

ALTER TABLE device_configuration_snapshots
  ALTER COLUMN processor TYPE varchar(500);

ALTER TABLE device_configuration_snapshots
  ALTER COLUMN graphics TYPE varchar(500);

INSERT INTO account_codes (
  id, code, name, account_type, account_group, sub_group,
  is_active, is_dynamic, balance, notes, created_at, updated_at
)
SELECT gen_random_uuid(), v.code, v.name, v.account_type, v.account_group, v.sub_group,
       true, false, 0, v.notes, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  VALUES
    ('6200', 'Inventory Adjustment', 'expense', 'Direct Expenses', 'Inventory',
     'Stock count / reconfiguration inventory adjustment'),
    ('6205', 'Inventory Write-off', 'expense', 'Direct Expenses', 'Inventory',
     'Damaged / obsolete stock write-off'),
    ('6210', 'Purchase Price Difference', 'expense', 'Direct Expenses', 'Inventory',
     'GRN vs vendor-bill purchase price variance')
) AS v(code, name, account_type, account_group, sub_group, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM account_codes a WHERE a.code = v.code
);

COMMIT;
