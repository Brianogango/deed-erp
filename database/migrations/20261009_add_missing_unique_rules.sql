-- Fix: add the unique rules the app's schema expects that this database is
-- missing. Without them the app's saves that rely on one fail ("no unique
-- or exclusion constraint matching the ON CONFLICT specification") — stock
-- moves and delivery notes on production. A rule whose columns already hold
-- duplicate values is not added; it is listed with a sample instead.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < database/migrations/20261009_add_missing_unique_rules.sql

CREATE TEMP TABLE unique_rule_result (tbl text, rule text, outcome text);

DO $$
DECLARE
  r record;
  cols text;
  dup boolean;
  owner_name text;
BEGIN
  SELECT tableowner INTO owner_name FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoices';
  FOR r IN SELECT * FROM (VALUES
    ('leave_policies', 'leave_policies_effective_year_key', ARRAY['effective_year']),
    ('users', 'users_employee_id_key', ARRAY['employee_id']),
    ('users', 'users_username_key', ARRAY['username']),
    ('users', 'users_email_key', ARRAY['email']),
    ('user_sessions', 'user_sessions_token_hash_key', ARRAY['token_hash']),
    ('departments', 'departments_name_key', ARRAY['name']),
    ('employees', 'employees_employee_number_key', ARRAY['employee_number']),
    ('employees', 'employees_id_number_key', ARRAY['id_number']),
    ('leave_requests', 'leave_requests_reference_key', ARRAY['reference']),
    ('leave_balances', 'uq_leave_balance_emp_type_year', ARRAY['employee_id', 'leave_type', 'year']),
    ('attendance_records', 'attendance_records_employee_id_work_date_key', ARRAY['employee_id', 'work_date']),
    ('payroll_runs', 'payroll_runs_run_reference_key', ARRAY['run_reference']),
    ('salary_advances', 'salary_advances_reference_key', ARRAY['reference']),
    ('clients', 'clients_client_number_key', ARRAY['client_number']),
    ('suppliers', 'suppliers_supplier_number_key', ARRAY['supplier_number']),
    ('brands', 'brands_name_key', ARRAY['name']),
    ('products', 'products_sku_key', ARRAY['sku']),
    ('products', 'products_barcode_key', ARRAY['barcode']),
    ('serial_numbers', 'serial_numbers_serial_number_key', ARRAY['serial_number']),
    ('serial_numbers', 'serial_numbers_inventory_barcode_key', ARRAY['inventory_barcode']),
    ('partner_api_keys', 'partner_api_keys_key_hash_key', ARRAY['key_hash']),
    ('stock_levels', 'stock_levels_product_id_key', ARRAY['product_id']),
    ('bulk_stock_levels', 'uq_bulk_stock_product_location', ARRAY['product_id', 'location']),
    ('inventory_batches', 'idx_inventory_batches_product_batch', ARRAY['product_id', 'batch_number']),
    ('stock_movements', 'uq_stock_movements_blob_id', ARRAY['blob_id']),
    ('stock_adjustments', 'stock_adjustments_reference_key', ARRAY['reference']),
    ('purchase_orders', 'purchase_orders_po_number_key', ARRAY['po_number']),
    ('goods_received_notes', 'goods_received_notes_grn_number_key', ARRAY['grn_number']),
    ('supplier_payments', 'supplier_payments_idempotency_key_key', ARRAY['idempotency_key']),
    ('leads', 'leads_inbound_message_id_key', ARRAY['inbound_message_id']),
    ('sales_inbound_emails', 'sales_inbound_emails_provider_msg_uniq', ARRAY['provider', 'mailbox', 'provider_message_id']),
    ('sale_orders', 'sale_orders_order_number_key', ARRAY['order_number']),
    ('sale_orders', 'sale_orders_quote_id_key', ARRAY['quote_id']),
    ('sale_orders', 'ux_sale_orders_version', ARRAY['version_group_id', 'version_number']),
    ('quotes', 'quotes_quote_number_key', ARRAY['quote_number']),
    ('invoices', 'invoices_invoice_number_key', ARRAY['invoice_number']),
    ('payments', 'payments_idempotency_key_key', ARRAY['idempotency_key']),
    ('mpesa_stk_requests', 'mpesa_stk_requests_merchant_request_id_key', ARRAY['merchant_request_id']),
    ('mpesa_stk_requests', 'mpesa_stk_requests_checkout_request_id_key', ARRAY['checkout_request_id']),
    ('credit_notes', 'credit_notes_credit_note_number_key', ARRAY['credit_note_number']),
    ('delivery_notes', 'delivery_notes_blob_id_key', ARRAY['blob_id']),
    ('delivery_notes', 'delivery_notes_dn_number_key', ARRAY['dn_number']),
    ('repairs', 'repairs_job_number_key', ARRAY['job_number']),
    ('pos_sessions', 'pos_sessions_session_number_key', ARRAY['session_number']),
    ('pos_transactions', 'pos_transactions_transaction_number_key', ARRAY['transaction_number']),
    ('kilimall_listings', 'kilimall_listings_product_id_key', ARRAY['product_id']),
    ('kilimall_listings', 'kilimall_listings_kilimall_sku_key', ARRAY['kilimall_sku']),
    ('kilimall_orders', 'kilimall_orders_kilimall_order_id_key', ARRAY['kilimall_order_id']),
    ('outbound_releases', 'outbound_releases_ref_key', ARRAY['ref']),
    ('outbound_releases', 'outbound_releases_invoice_id_key', ARRAY['invoice_id']),
    ('outbound_releases', 'outbound_releases_repair_id_key', ARRAY['repair_id']),
    ('outbound_releases', 'outbound_releases_delivery_note_id_key', ARRAY['delivery_note_id']),
    ('ai_documents', 'uq_ai_documents_source', ARRAY['source_type', 'source_id']),
    ('account_codes', 'account_codes_code_key', ARRAY['code']),
    ('journals', 'journals_code_key', ARRAY['code']),
    ('journal_entries', 'journal_entries_ref_key', ARRAY['ref']),
    ('journal_entries', 'uq_journal_source_version', ARRAY['source_type', 'source_id', 'source_version']),
    ('analytic_accounts', 'analytic_accounts_code_key', ARRAY['code']),
    ('analytic_budget_lines', 'uq_analytic_budget_dimension', ARRAY['budget_id', 'analytic_account_id', 'account_code']),
    ('product_valuations', 'product_valuations_product_id_key', ARRAY['product_id']),
    ('valuation_events', 'valuation_events_event_key_key', ARRAY['event_key']),
    ('approval_rules', 'approval_rules_approval_type_key', ARRAY['approval_type']),
    ('deposits', 'uq_deposits_ref', ARRAY['ref']),
    ('deposit_payments', 'deposit_payments_idempotency_key_key', ARRAY['idempotency_key']),
    ('holdovers', 'uq_holdovers_ref', ARRAY['ref']),
    ('price_lists', 'price_lists_code_key', ARRAY['code']),
    ('device_serial_costs', 'device_serial_costs_serial_id_key', ARRAY['serial_id']),
    ('reconfiguration_work_orders', 'reconfiguration_work_orders_ref_key', ARRAY['ref']),
    ('reconfiguration_work_orders', 'reconfiguration_work_orders_valuation_event_key_key', ARRAY['valuation_event_key']),
    ('reconfiguration_work_orders', 'reconfiguration_work_orders_completion_event_key_key', ARRAY['completion_event_key']),
    ('reconfiguration_qa_checks', 'reconfiguration_qa_checks_work_order_id_check_key_key', ARRAY['work_order_id', 'check_key']),
    ('fiscal_periods', 'uq_fiscal_period_dates', ARRAY['date_from', 'date_to']),
    ('bank_accounts', 'uq_bank_account_name', ARRAY['name']),
    ('bank_statements', 'uq_bank_statement_ref', ARRAY['bank_account_id', 'statement_ref']),
    ('bank_statement_lines', 'uq_statement_external_id', ARRAY['statement_id', 'external_id']),
    ('bank_reconciliation_matches', 'uq_bank_recon_match', ARRAY['statement_line_id', 'journal_entry_id']),
    ('expense_records', 'expense_records_reference_key', ARRAY['reference']),
    ('tax_transactions', 'uq_tax_source_line', ARRAY['source_type', 'source_id', 'source_line_id']),
    ('inventory_ledger_entries', 'inventory_ledger_entries_event_key_key', ARRAY['event_key']),
    ('statutory_rule_versions', 'uq_statutory_rule_effective', ARRAY['code', 'effective_from']),
    ('fixed_assets', 'fixed_assets_asset_number_key', ARRAY['asset_number']),
    ('asset_depreciation_entries', 'uq_asset_depreciation_period', ARRAY['fixed_asset_id', 'period']),
    ('financial_reconciliations', 'uq_fin_reconciliation_period', ARRAY['control_type', 'period_end']),
    ('notification_events', 'notification_events_idempotency_key_key', ARRAY['idempotency_key']),
    ('notification_recipients', 'notification_recipients_event_id_user_id_key', ARRAY['event_id', 'user_id']),
    ('notification_outbox', 'notification_outbox_event_id_key', ARRAY['event_id']),
    ('notification_deliveries', 'notification_deliveries_idempotency_key_key', ARRAY['idempotency_key']),
    ('notification_attempts', 'notification_attempts_delivery_id_attempt_no_key', ARRAY['delivery_id', 'attempt_no']),
    ('notification_preferences', 'notification_preferences_user_id_event_type_key', ARRAY['user_id', 'event_type']),
    ('notification_templates', 'notification_templates_event_type_channel_version_key', ARRAY['event_type', 'channel', 'version']),
    ('notification_escalations', 'notification_escalations_event_id_level_target_user_id_key', ARRAY['event_id', 'level', 'target_user_id']),
    ('communication_threads', 'communication_threads_thread_key_key', ARRAY['thread_key']),
    ('communication_messages', 'communication_messages_provider_message_key_key', ARRAY['provider_message_key']),
    ('communication_messages', 'communication_messages_notification_delivery_id_key', ARRAY['notification_delivery_id']),
    ('notification_dead_letters', 'notification_dead_letters_delivery_id_key', ARRAY['delivery_id']),
    ('report_snapshots', 'report_snapshots_scope_key_key', ARRAY['scope_key']),
    ('background_jobs', 'background_jobs_unique_key_key', ARRAY['unique_key']),
    ('erp_state_records', 'uq_erp_state_record_key', ARRAY['key', 'record_key'])
  ) AS v(tbl, rule, cols) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = r.tbl) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = r.rule)
       OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.rule) THEN CONTINUE; END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(r.cols) c
      WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_schema = 'public' AND ic.table_name = r.tbl AND ic.column_name = c)
    ) THEN
      INSERT INTO unique_rule_result VALUES (r.tbl, r.rule, 'column missing — not added');
      CONTINUE;
    END IF;
    SELECT string_agg(format('%I', c), ', ') INTO cols FROM unnest(r.cols) c;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE %s GROUP BY %s HAVING count(*) > 1)',
      r.tbl,
      (SELECT string_agg(format('%I IS NOT NULL', c), ' AND ') FROM unnest(r.cols) c),
      cols) INTO dup;
    IF dup THEN
      INSERT INTO unique_rule_result VALUES (r.tbl, r.rule, 'DUPLICATES — not added');
    ELSE
      EXECUTE format('CREATE UNIQUE INDEX %I ON public.%I (%s)', r.rule, r.tbl, cols);
      IF owner_name IS NOT NULL THEN
        EXECUTE format('ALTER INDEX public.%I OWNER TO %I', r.rule, owner_name);
      END IF;
      INSERT INTO unique_rule_result VALUES (r.tbl, r.rule, 'added');
    END IF;
  END LOOP;
END $$;

SELECT * FROM unique_rule_result ORDER BY outcome, tbl;
