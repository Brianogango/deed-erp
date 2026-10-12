#!/usr/bin/env bash
# Read-only. Where the ERP's time goes: the server, the app (PM2), the web
# server (Nginx) and the database. Changes nothing.
#
#   cd /var/www/deed-erp
#   sudo bash scripts/perf-snapshot.sh > /tmp/perf-snapshot.txt 2>&1
#   less /tmp/perf-snapshot.txt
#
# Best run while the ERP feels slow (during working hours). No passwords or
# connection strings are printed.

APP_DIR=${APP_DIR:-/var/www/deed-erp}
APP_USER=${APP_USER:-deedapp}
PM2_APP=${PM2_APP:-deed-erp}
NGINX_LOG=${NGINX_LOG:-/var/log/nginx/access.log}

cd "$APP_DIR" || exit 1
DB=$(grep -h '^DATABASE_URL' .env* 2>/dev/null | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')

section() { echo; echo "=================== $* ==================="; }

section "1. Server: CPU, memory, disk"
date
echo "CPU cores: $(nproc)"
uptime
free -m
swapon --show 2>/dev/null
df -h / /var 2>/dev/null | sort -u
echo; echo "-- CPU / IO over 5 seconds (wa = waiting on disk, si/so = swapping)"
vmstat 1 5
echo; echo "-- Biggest processes by memory"
ps -eo pid,user,%cpu,%mem,rss,etime,comm --sort=-rss | head -12
echo; echo "-- Out-of-memory kills (last 7 days)"
journalctl -k --since "7 days ago" 2>/dev/null | grep -i "out of memory\|oom-kill\|killed process" | tail -10 || dmesg 2>/dev/null | grep -i "oom" | tail -10

section "2. App workers (PM2)"
sudo -u "$APP_USER" pm2 jlist 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{
  for (const p of JSON.parse(s)) {
    const e=p.pm2_env||{};
    console.log([p.name, "id="+p.pm_id, e.status, "restarts="+e.restart_time, "unstable="+e.unstable_restarts,
      "up="+Math.round((Date.now()-e.pm_uptime)/60000)+"min", "mem="+Math.round((p.monit?.memory||0)/1048576)+"MB", "cpu="+(p.monit?.cpu??"?")+"%"].join("  "))
  }}catch(err){console.log("could not read pm2 jlist:",err.message)}})'

LOGS=$(ls /home/"$APP_USER"/.pm2/logs/"$PM2_APP"-*.log 2>/dev/null)
echo; echo "-- Slow screen-data loads (server-store), last 40"
grep -h "slow overlay phase" $LOGS 2>/dev/null | tail -40
echo; echo "-- How often (count of slow loads in the logs)"
grep -h "slow overlay phase" $LOGS 2>/dev/null | wc -l
echo; echo "-- Most frequent errors / warnings (last 5000 log lines, numbers removed so similar lines group)"
for f in $LOGS; do tail -5000 "$f"; done 2>/dev/null | grep -iE "error|warn|timeout|ECONN|P10|P20|heap|memory" \
  | sed -E 's/[0-9a-f]{8}-[0-9a-f-]{27}/<id>/g; s/[0-9]+/N/g' | cut -c1-180 | sort | uniq -c | sort -rn | head -25
echo; echo "-- Worker restarts / memory limit hits"
grep -hiE "max_memory_restart|exceeds|restarting|exited with code|SIGKILL|heap out of memory" /home/"$APP_USER"/.pm2/pm2.log 2>/dev/null | tail -15

section "3. Response times (from this server, no login)"
for path in /login /api/version; do
  curl -s -o /dev/null -w "$path  status=%{http_code}  total=%{time_total}s  first-byte=%{time_starttransfer}s\n" "http://localhost:3000$path"
done

section "4. Web server (Nginx)"
echo "-- Log format (does it record request time?)"
grep -rh "log_format\|access_log" /etc/nginx/nginx.conf /etc/nginx/sites-enabled/ 2>/dev/null | grep -v "^\s*#" | head -8
echo; echo "-- Busiest paths, last 20000 requests (ids/numbers removed so similar paths group)"
tail -20000 "$NGINX_LOG" 2>/dev/null | awk '{print $7}' | sed -E 's/\?.*//; s/[0-9a-f]{8}-[0-9a-f-]{27}/<id>/g; s#/[0-9]+#/N#g' \
  | sort | uniq -c | sort -rn | head -25
echo; echo "-- Requests per minute, last 15 minutes"
tail -20000 "$NGINX_LOG" 2>/dev/null | awk '{print substr($4,2,17)}' | uniq -c | tail -15
echo; echo "-- Status codes, last 20000 requests"
tail -20000 "$NGINX_LOG" 2>/dev/null | awk '{print $9}' | sort | uniq -c | sort -rn | head -8
echo; echo "-- Slowest requests, if the log records request time as its last field"
tail -20000 "$NGINX_LOG" 2>/dev/null | awk '$NF ~ /^[0-9]+\.[0-9]+$/ {print $NF, $7}' | sed -E 's/\?.*//' | sort -rn | head -25
echo; echo "-- Nginx errors (timeouts, upstream), last 15"
tail -2000 /var/log/nginx/error.log 2>/dev/null | grep -iE "timed out|upstream|refused|too many" | cut -c1-220 | tail -15

section "5. Database"
if [ -z "$DB" ]; then echo "Could not find the database name in .env"; exit 0; fi
sudo -u postgres psql -X -P pager=off -d "$DB" <<'SQL'
\pset null '-'
\echo '-- Connections by state'
SELECT state, count(*) , max(now() - state_change)::interval(0) AS longest_in_state
FROM pg_stat_activity WHERE datname = current_database() GROUP BY state ORDER BY 2 DESC;

\echo '-- Queries running longer than 1 second right now'
SELECT pid, (now() - query_start)::interval(0) AS running, wait_event_type, wait_event, left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS query
FROM pg_stat_activity
WHERE datname = current_database() AND state <> 'idle' AND now() - query_start > interval '1 second' AND pid <> pg_backend_pid()
ORDER BY query_start;

\echo '-- Waiting on locks'
SELECT count(*) AS waiting_on_locks FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database();

\echo '-- Database size and cache hit rate (should be above 99%)'
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size,
       round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 2) AS cache_hit_pct,
       xact_commit, xact_rollback, deadlocks, temp_files, pg_size_pretty(temp_bytes) AS temp_written
FROM pg_stat_database WHERE datname = current_database();

\echo '-- Biggest tables'
SELECT relname AS table, pg_size_pretty(pg_total_relation_size(relid)) AS total, n_live_tup AS rows, n_dead_tup AS dead_rows,
       last_autovacuum::timestamp(0) AS last_autovacuum
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 20;

\echo '-- Tables read end-to-end a lot (possible missing index)'
SELECT relname AS table, seq_scan, seq_tup_read, idx_scan, n_live_tup AS rows,
       seq_tup_read / nullif(seq_scan, 0) AS avg_rows_per_scan
FROM pg_stat_user_tables WHERE seq_scan > 0 AND n_live_tup > 2000
ORDER BY seq_tup_read DESC LIMIT 15;

\echo '-- Screen copies: rows per list (erp_state_records)'
SELECT key, count(*) AS rows, pg_size_pretty(sum(pg_column_size(payload))::bigint) AS size
FROM erp_state_records GROUP BY key ORDER BY sum(pg_column_size(payload)) DESC LIMIT 20;

\echo '-- app_state rows by size'
SELECT key, pg_size_pretty(pg_column_size(t.*)::bigint) AS size, updated_at::timestamp(0)
FROM app_state t ORDER BY pg_column_size(t.*) DESC LIMIT 15;

\echo '-- Settings that matter for speed'
SELECT name, setting, unit FROM pg_settings
WHERE name IN ('shared_buffers', 'work_mem', 'effective_cache_size', 'max_connections', 'random_page_cost', 'shared_preload_libraries');

\echo '-- Slowest queries in total (only if pg_stat_statements is installed)'
SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS pg_stat_statements_installed \gset
\if :pg_stat_statements_installed
  SELECT calls, round(total_exec_time::numeric / 1000, 1) AS total_s, round(mean_exec_time::numeric, 1) AS mean_ms,
         rows, left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS query
  FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  ORDER BY total_exec_time DESC LIMIT 20;
\else
  \echo 'not installed (optional; it records which queries take the most time)'
\endif
SQL

section "Done"
echo "Send the whole file. Nothing was changed."
