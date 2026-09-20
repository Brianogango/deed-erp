-- Redis cache/queues, object store, and read-optimised reporting path.
-- Additive and idempotent. Safe to re-run. Never deletes app_state.

CREATE TABLE IF NOT EXISTS "report_snapshots" (
  "id" UUID NOT NULL,
  "scope_key" VARCHAR(220) NOT NULL,
  "kind" VARCHAR(40) NOT NULL,
  "params" JSONB NOT NULL DEFAULT '{}',
  "payload" JSONB NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "report_snapshots_scope_key_key" UNIQUE ("scope_key")
);

CREATE INDEX IF NOT EXISTS "idx_report_snapshots_kind_generated"
  ON "report_snapshots" ("kind", "generated_at");

CREATE TABLE IF NOT EXISTS "background_jobs" (
  "id" UUID NOT NULL,
  "type" VARCHAR(80) NOT NULL,
  "queue" VARCHAR(40) NOT NULL DEFAULT 'default',
  "payload" JSONB NOT NULL DEFAULT '{}',
  "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
  "unique_key" VARCHAR(200),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "locked_by" VARCHAR(80),
  "last_error" TEXT,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "background_jobs_unique_key_key" UNIQUE ("unique_key"),
  CONSTRAINT "ck_background_jobs_status" CHECK ("status" IN ('queued','running','retrying','completed','failed'))
);

CREATE INDEX IF NOT EXISTS "idx_background_jobs_claim"
  ON "background_jobs" ("status", "run_at");

CREATE INDEX IF NOT EXISTS "idx_background_jobs_queue"
  ON "background_jobs" ("queue", "status");

-- Posted-date covering index for GL reporting scans on the operational (and replica) DB.
CREATE INDEX IF NOT EXISTS "idx_journal_entries_posted_date"
  ON "journal_entries" ("is_posted", "entry_date")
  WHERE "is_posted" = true;
