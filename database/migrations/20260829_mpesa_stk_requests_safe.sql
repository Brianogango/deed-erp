-- Lipa na M-Pesa Online (STK Express) request log.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS mpesa_stk_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_request_id varchar(80) NOT NULL,
  checkout_request_id varchar(80) NOT NULL,
  phone varchar(20) NOT NULL,
  amount numeric(14, 2) NOT NULL,
  account_reference varchar(20) NOT NULL,
  description varchar(80) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  result_code varchar(10),
  result_desc varchar(200),
  mpesa_receipt varchar(20),
  invoice_id uuid,
  source varchar(20) NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_callback jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS mpesa_stk_requests_merchant_request_id_key
  ON mpesa_stk_requests (merchant_request_id);
CREATE UNIQUE INDEX IF NOT EXISTS mpesa_stk_requests_checkout_request_id_key
  ON mpesa_stk_requests (checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_stk_status ON mpesa_stk_requests (status);
CREATE INDEX IF NOT EXISTS idx_mpesa_stk_invoice ON mpesa_stk_requests (invoice_id);
