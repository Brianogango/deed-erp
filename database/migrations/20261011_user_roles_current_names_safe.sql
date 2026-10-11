-- Users saved under an old role name get the current one, so every lookup by
-- role finds them. Permissions do not change: the app already treats each old
-- name as its current one (lib/auth/authorization.ts normalizePermissionRole).
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < database/migrations/20261011_user_roles_current_names_safe.sql

\echo 'Before'
SELECT role::text, count(*) AS users FROM users GROUP BY 1 ORDER BY 1;

BEGIN;
UPDATE users SET role = 'director'          WHERE role::text IN ('admin', 'super_admin');
UPDATE users SET role = 'finance_officer'   WHERE role::text = 'finance';
UPDATE users SET role = 'inventory_officer' WHERE role::text = 'inventory';
UPDATE users SET role = 'kilimall_officer'  WHERE role::text = 'kilimall';
UPDATE users SET role = 'sales_rep'         WHERE role::text = 'sales';
UPDATE users SET role = 'technical_lead'    WHERE role::text = 'lead_tech';
UPDATE users SET role = 'technician'        WHERE role::text = 'repair_tech';
COMMIT;

\echo 'After (only current names should remain)'
SELECT role::text, count(*) AS users FROM users GROUP BY 1 ORDER BY 1;
