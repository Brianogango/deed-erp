-- Migration: Add qty_delivered column to sale_order_items
-- This enables per-line delivery quantity tracking in the Sales module (Odoo-style)

ALTER TABLE sale_order_items
  ADD COLUMN IF NOT EXISTS qty_delivered INTEGER NOT NULL DEFAULT 0;
