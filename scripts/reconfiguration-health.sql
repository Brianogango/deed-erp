-- Read-only. Health check for device reconfiguration (bench jobs).
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/reconfiguration-health.sql > /tmp/reconfig-health.txt
--   less -S /tmp/reconfig-health.txt

\pset null '-'

\echo '1. Jobs by status'
SELECT status, count(*) AS jobs, min(created_at)::date AS first, max(created_at)::date AS latest
FROM reconfiguration_work_orders GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '2. Stuck jobs: not finished and older than an hour. A bench job that failed half-way stays here,'
\echo '   and the machine cannot be reconfigured again until it is dealt with.'
SELECT w.ref, w.manufacturer_serial AS serial, w.status, w.created_at::timestamp(0) AS started, u.username AS by,
       (SELECT count(*) FROM reconfiguration_removal_lines r WHERE r.work_order_id = w.id AND r.actual_removed_at IS NOT NULL) AS parts_pulled,
       (SELECT count(*) FROM reconfiguration_installation_lines i WHERE i.work_order_id = w.id AND i.installed_at IS NOT NULL) AS parts_fitted
FROM reconfiguration_work_orders w LEFT JOIN users u ON u.id = w.created_by
WHERE w.status NOT IN ('completed', 'cancelled', 'reversed') AND w.created_at < now() - interval '1 hour'
ORDER BY w.created_at;

\echo ''
\echo '3. Completed jobs that LOWERED the unit price (blank price used to mean cost + 25%)'
SELECT w.ref, w.manufacturer_serial AS serial, w.date_completed::date AS done, w.price_method AS method,
       w.selling_price_before AS price_before, w.final_selling_price AS price_after,
       w.final_selling_price - w.selling_price_before AS change, w.cost_before, w.cost_after
FROM reconfiguration_work_orders w
WHERE w.status = 'completed' AND w.selling_price_before > 0 AND w.final_selling_price < w.selling_price_before
ORDER BY w.date_completed DESC LIMIT 50;

\echo ''
\echo '4. Machines whose recorded cost differs from their latest completed job''s cost-after'
SELECT * FROM (
  SELECT DISTINCT ON (w.serial_id) w.ref, w.manufacturer_serial AS serial, w.cost_after AS job_cost_after, c.current_cost AS cost_now,
         c.updated_at::timestamp(0) AS cost_changed
  FROM reconfiguration_work_orders w JOIN device_serial_costs c ON c.serial_id = w.serial_id
  WHERE w.status = 'completed'
  ORDER BY w.serial_id, w.date_completed DESC
) latest
WHERE abs(job_cost_after - cost_now) > 1
ORDER BY cost_changed DESC;

\echo ''
\echo '5. Completed jobs with a part not actually moved in stock, or no accounting entry when cost changed'
SELECT w.ref, w.manufacturer_serial AS serial, w.date_completed::date AS done,
       (SELECT count(*) FROM reconfiguration_removal_lines r WHERE r.work_order_id = w.id AND r.stock_move_ref IS NULL) AS pulls_without_move,
       (SELECT count(*) FROM reconfiguration_installation_lines i WHERE i.work_order_id = w.id AND i.stock_move_ref IS NULL) AS fits_without_move,
       CASE WHEN (w.cost_removed + w.cost_installed + w.labour_cost + w.other_cost) > 0
             AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.ref = left('JRN/STK/RCF/' || w.ref, 80)) THEN 'MISSING' ELSE '' END AS journal
FROM reconfiguration_work_orders w
WHERE w.status = 'completed'
  AND (EXISTS (SELECT 1 FROM reconfiguration_removal_lines r WHERE r.work_order_id = w.id AND r.stock_move_ref IS NULL)
    OR EXISTS (SELECT 1 FROM reconfiguration_installation_lines i WHERE i.work_order_id = w.id AND i.stock_move_ref IS NULL)
    OR ((w.cost_removed + w.cost_installed + w.labour_cost + w.other_cost) > 0
        AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.ref = left('JRN/STK/RCF/' || w.ref, 80))))
ORDER BY w.date_completed DESC;

\echo ''
\echo '6. Machines whose shown specs do not match their current configuration after a job'
SELECT w.ref, s.serial_number AS serial, snap.display_name AS configured_as, coalesce(s.screen_extras->>'specs', s.notes) AS shown_as
FROM reconfiguration_work_orders w
JOIN serial_numbers s ON s.id = w.serial_id
JOIN device_configuration_snapshots snap ON snap.serial_id = s.id AND snap.is_current
WHERE w.status = 'completed'
  AND w.date_completed = (SELECT max(w2.date_completed) FROM reconfiguration_work_orders w2 WHERE w2.serial_id = w.serial_id AND w2.status = 'completed')
  AND coalesce(s.screen_extras->>'specs', s.notes, '') <> coalesce(snap.display_name, '')
  AND (snap.total_ram_gb IS NOT NULL AND coalesce(s.screen_extras->>'specs', s.notes, '') NOT ILIKE '%' || snap.total_ram_gb || '%GB%')
ORDER BY w.date_completed DESC LIMIT 40;

\echo ''
\echo '7. Parts pulled from machines still waiting to be tested (sitting in Pending Testing)'
SELECT p.name AS part, count(*) AS pulled, min(r.actual_removed_at)::date AS oldest
FROM reconfiguration_removal_lines r JOIN products p ON p.id = r.component_product_id
WHERE r.actual_removed_at IS NOT NULL AND r.disposition = 'pending_testing' AND coalesce(r.qa_status, 'pending') = 'pending'
GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '8. Serials marked removed in the last 30 days, with when they were created (removal-by-absence check)'
SELECT s.serial_number, s.created_at::timestamp(0) AS created, s.removed_at::timestamp(0) AS removed,
       round(extract(epoch FROM (s.removed_at - s.created_at)) / 60) AS minutes_between
FROM serial_numbers s
WHERE s.removed_at > now() - interval '30 days'
ORDER BY s.removed_at DESC LIMIT 40;
