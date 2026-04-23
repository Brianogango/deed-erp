-- Migration for Admin Settings
ALTER TABLE User ADD COLUMN permissions JSONB DEFAULT '{}';

CREATE TABLE company_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  logo_url TEXT,
  company_name TEXT DEFAULT 'Deed Technologies Ltd',
  footer_text TEXT,
  vat_rate DECIMAL DEFAULT 0.16,
  currency TEXT DEFAULT 'KES',
  address TEXT,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_no TEXT UNIQUE NOT NULL,
  opening_balance DECIMAL DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed default settings
INSERT INTO company_settings (logo_url, company_name, footer_text, address, phone, email) VALUES 
('/logo.png', 'Deed Technologies Ltd', 'Nairobi, Kenya | Tel: +254 700 123456', 'P.O. Box 12345-00100 Nairobi', '+254700123456', 'info@deed.co.ke') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO bank_accounts (name, bank_name, account_no, opening_balance) VALUES 
('NCBA Current', 'NCBA Bank Kenya', '1005157785', 1640000),
('Equity Business', 'Equity Bank Kenya', '0670200000', 490000)
ON CONFLICT (account_no) DO NOTHING;

