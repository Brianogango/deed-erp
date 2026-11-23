-- How a vendor gets paid. The clients table already carried bank_name,
-- bank_account and bank_branch, and the contact detail panel rendered them —
-- but the contact form had no input for any of the three, so every vendor's
-- "Banking details" panel read "—" and the columns were never written.
--
-- Most Kenyan suppliers are paid by M-Pesa rather than bank transfer, so the
-- bank columns alone could not hold the answer. These three complete it:
--
--   mpesa_paybill  the Paybill or Till number (a Till has no account number)
--   mpesa_account  the account number a Paybill needs; empty for a Till
--   pay_by         'bank' or 'mpesa' — which rail this vendor prefers when
--                  both are on file. NULL means nobody has said.
--
-- The names match the mpesaPaybill / mpesaAccount already on the company's own
-- bank accounts, so the same two words mean the same thing on both sides of a
-- payment.
--
-- Apply with the helper, which reads the connection string out of .env and
-- runs as the OS postgres role that owns the tables:
--
--   cd /var/www/deed-erp
--   sudo bash scripts/apply-sql-as-postgres.sh prisma/migrations/017_client_mpesa_payment_details.sql
--
-- (psql "$DATABASE_URL" does not work from a root shell: the variable lives
-- in the app's .env, not in the environment, and the app's DB user does not
-- own the table.)
--
-- Every column is nullable and nothing backfills: existing contacts keep NULL
-- and read as "not set" until somebody fills the form in.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS mpesa_paybill varchar(20),
  ADD COLUMN IF NOT EXISTS mpesa_account varchar(60),
  ADD COLUMN IF NOT EXISTS pay_by        varchar(10);
