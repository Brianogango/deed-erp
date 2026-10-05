-- Read-only. Why Inventory shows more units than are really on the shelf.
-- Run: sudo -u postgres psql -P pager=off -d "$DB" -f scripts/diagnostics/stock-sold-not-deducted.sql

-- 1) Confirmed sales with an invoice but NO validated delivery: stock was never deducted.
select so.payload->>'ref' as sale_order, so.payload->>'customerName' as customer,
       string_agg(distinct i.payload->>'ref', ', ') as invoices,
       (select string_agg((l->>'productName') || ' x' || (l->>'qty'), '; ') from jsonb_array_elements(so.payload->'lines') l) as items
from erp_state_records so
join erp_state_records i on i.key = 'deed_invoices' and i.payload->>'saleOrderId' = so.payload->>'id'
     and i.payload->>'status' not in ('draft', 'cancelled', 'voided')
where so.key = 'deed_saleOrders' and so.payload->>'status' in ('sale', 'done')
  and not exists (select 1 from erp_state_records d where d.key = 'deed_deliveries'
                  and d.payload->>'saleOrderId' = so.payload->>'id' and d.payload->>'status' = 'done')
group by so.id, so.payload order by 1;

-- 2) Serial units tied to a confirmed sale order but still counted as in stock.
select s.payload->>'serial' as serial, s.payload->>'productName' as product, s.payload->>'location' as location,
       so.payload->>'ref' as sale_order, so.payload->>'status' as so_status
from erp_state_records s
join erp_state_records so on so.key = 'deed_saleOrders' and so.payload->>'id' = s.payload->>'saleOrderId'
where s.key = 'deed_serials' and s.payload->>'status' <> 'sold' and so.payload->>'status' in ('sale', 'done')
order by 4, 2;

-- 3) Units counted as in stock, by location.
select coalesce(s.payload->>'location', '?') as location, count(*) as units
from erp_state_records s
where s.key = 'deed_serials' and s.payload->>'status' <> 'sold' group by 1 order by 2 desc;
