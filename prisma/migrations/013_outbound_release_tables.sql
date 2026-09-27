-- 013: create the Outbound Release Control tables.
--
-- OutboundRelease, OutboundReleaseItem and OutboundReleaseLog have been in
-- prisma/schema.prisma for some time, but no migration ever created them and
-- there is no DDL for them anywhere in the repository. So every
-- prisma.outboundRelease.create() in production has been failing on a missing
-- relation, and the release panel could never record a release at all.
--
-- Migration 012 assumed the table existed and only relaxed a constraint; it
-- errored without changing anything. This migration creates the tables with
-- serial_number_id already nullable, which is what 012 was trying to achieve,
-- so applying 013 alone is sufficient. Running 012 afterwards is harmless.
--
-- Safe to re-run.

DO $$ BEGIN
  CREATE TYPE release_status AS ENUM ('pending', 'all_picked', 'verified', 'released', 'voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE item_release_status AS ENUM ('picked', 'verified', 'released');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE signature_method AS ENUM ('digital', 'paper');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS outbound_releases (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                     VARCHAR(30)  NOT NULL UNIQUE,

  -- Source document — exactly one is non-null. SET NULL on delete so a
  -- cancelled source never erases the release record itself.
  invoice_id              UUID UNIQUE REFERENCES invoices(id)       ON DELETE SET NULL,
  repair_id               UUID UNIQUE REFERENCES repairs(id)        ON DELETE SET NULL,
  delivery_note_id        UUID UNIQUE REFERENCES delivery_notes(id) ON DELETE SET NULL,

  client_id               UUID NOT NULL REFERENCES clients(id),
  status                  release_status NOT NULL DEFAULT 'pending',

  initiated_by            UUID NOT NULL REFERENCES users(id),
  initiated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  verified_by             UUID REFERENCES users(id),
  verified_at             TIMESTAMPTZ,

  received_by             VARCHAR(150),
  received_by_phone       VARCHAR(20),
  release_notes           TEXT,
  condition_on_release    TEXT,

  receiver_sig_data       TEXT,
  receiver_sig_method     signature_method,
  receiver_sig_ref        VARCHAR(200),

  releaser_sig_data       TEXT,
  releaser_sig_method     signature_method,
  releaser_sig_ref        VARCHAR(200),

  customer_ack_sig_data   TEXT,
  customer_ack_sig_method signature_method,
  customer_ack_sig_ref    VARCHAR(200),

  released_at             TIMESTAMPTZ,
  voided_by               UUID REFERENCES users(id),
  voided_at               TIMESTAMPTZ,
  void_reason             TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orc_invoice   ON outbound_releases (invoice_id);
CREATE INDEX IF NOT EXISTS idx_orc_repair    ON outbound_releases (repair_id);
CREATE INDEX IF NOT EXISTS idx_orc_client    ON outbound_releases (client_id);
CREATE INDEX IF NOT EXISTS idx_orc_verifier  ON outbound_releases (verified_by);
CREATE INDEX IF NOT EXISTS idx_orc_status    ON outbound_releases (status);
CREATE INDEX IF NOT EXISTS idx_orc_date      ON outbound_releases (initiated_at);

CREATE TABLE IF NOT EXISTS outbound_release_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id       UUID NOT NULL REFERENCES outbound_releases(id) ON DELETE CASCADE,
  -- Nullable on purpose: a customer's own device in for repair is not in
  -- Deed's serial register, so there is no row to point at. expected_serial
  -- carries the identity and verification compares against it. Stock leaving
  -- on a sale still requires the link — enforced in the API.
  serial_number_id UUID REFERENCES serial_numbers(id),
  expected_serial  VARCHAR(100) NOT NULL,
  confirmed_serial VARCHAR(100),
  serial_matched   BOOLEAN,
  status           item_release_status NOT NULL DEFAULT 'picked',
  verified_by      UUID REFERENCES users(id),
  verified_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orc_items_release ON outbound_release_items (release_id);
CREATE INDEX IF NOT EXISTS idx_orc_items_serial  ON outbound_release_items (serial_number_id);

CREATE TABLE IF NOT EXISTS outbound_release_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id    UUID NOT NULL REFERENCES outbound_releases(id) ON DELETE CASCADE,
  action        VARCHAR(50) NOT NULL,
  from_status   VARCHAR(30),
  to_status     VARCHAR(30),
  performed_by  UUID NOT NULL REFERENCES users(id),
  performed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes         TEXT,
  metadata      JSONB
);

CREATE INDEX IF NOT EXISTS idx_orc_log_release ON outbound_release_log (release_id);
CREATE INDEX IF NOT EXISTS idx_orc_log_date    ON outbound_release_log (performed_at);
CREATE INDEX IF NOT EXISTS idx_orc_log_actor   ON outbound_release_log (performed_by);

-- If the tables predated this migration in some environment, bring the one
-- column 012 cared about into line.
ALTER TABLE outbound_release_items ALTER COLUMN serial_number_id DROP NOT NULL;
