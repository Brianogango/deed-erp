import 'server-only'

import prisma from '@/lib/prisma'
import { FROZEN_STORE_KEYS, loadAppState, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { updateContactById, broadcastContacts, clientToContact } from '@/lib/contact-prisma'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { blanksToFill, collectionLabel, relinkContact } from './merge-core'

/**
 * Merge a duplicate contact into the one that stays.
 *
 * 1. Tables: every column that names a contact (client_id, partner_id,
 *    customer_id, supplier_id, vendor_id, contact_id, company_id…) and holds
 *    the duplicate's id is pointed at the survivor, in one transaction. This
 *    is where invoices, bills, quotes, orders, deliveries, journals, payments,
 *    deposits, holdovers and repairs live, so names on screen follow.
 * 2. Stored lists still saved as lists (credits, POS sales, CRM, warranties…,
 *    and serials / stock, which save to their tables) get the same relink.
 * 3. The survivor takes the duplicate's details where its own are empty; the
 *    duplicate is archived with a "Merged into…" note (never deleted).
 *
 * Re-running a merge that stopped half-way finishes it: every step only
 * touches what still names the duplicate.
 */

const CONTACT_COLUMN = '^(client|partner|customer|supplier|vendor|contact|company|payer|payee)_?id$'
const TEXTUAL = new Set(['uuid', 'text', 'character varying'])
// Lists the tables answer for; a save through the list would be dropped.
const LIST_ONLY_SKIP = new Set([...FROZEN_STORE_KEYS].filter(k => !['deed_serials', 'deed_bulkStock', 'deed_stockMoves', 'deed_receipts', 'deed_products', 'deed_stockReservations'].includes(k)))

const q = (name: string) => `"${name.replace(/"/g, '""')}"`

type Column = { table: string; column: string }
export type MergeArea = { label: string; count: number }
export type MergeOutcome = {
  survivor: { id: string; name: string }
  merged: { id: string; name: string }
  areas: MergeArea[]
  total: number
  filled: string[]
  /** Rows a table would not take (the survivor already has its own), left on the archived contact. */
  kept: MergeArea[]
  applied: boolean
}

async function contactColumns(): Promise<Column[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string; data_type: string }>>(
    `SELECT c.table_name, c.column_name, c.data_type
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name ~* $1`,
    CONTACT_COLUMN,
  )
  return rows.filter(r => TEXTUAL.has(r.data_type)).map(r => ({ table: r.table_name, column: r.column_name }))
}

const tableLabel = (table: string) => {
  const map: Record<string, string> = {
    invoices: 'Invoices and bills', quotes: 'Quotations', sale_orders: 'Sale orders', delivery_notes: 'Deliveries',
    repairs: 'Repairs', credit_notes: 'Credit notes', journal_entries: 'Journal entries', journal_entry_lines: 'Journal lines (balances, statements)',
    payments: 'Payments', invoice_payments: 'Payments', opportunities: 'Opportunities', contact_persons: 'Contact people',
    purchase_orders: 'Purchase orders', deposits: 'Deposits', holdovers: 'Holdovers',
  }
  return map[table] ?? table.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
}

function addArea(list: MergeArea[], label: string, count: number) {
  if (!count) return
  const hit = list.find(a => a.label === label)
  if (hit) hit.count += count
  else list.push({ label, count })
}

export async function mergeContacts(params: { survivorId: string; mergedId: string; userId: string; apply: boolean }): Promise<MergeOutcome> {
  const { survivorId, mergedId } = params
  const [survivor, merged] = await Promise.all([
    prisma.client.findUnique({ where: { id: survivorId } }),
    prisma.client.findUnique({ where: { id: mergedId } }),
  ])
  if (!survivor || !merged) throw Object.assign(new Error('One of the two contacts was not found'), { status: 404 })

  const outcome: MergeOutcome = {
    survivor: { id: survivor.id, name: survivor.name },
    merged: { id: merged.id, name: merged.name },
    areas: [], total: 0, filled: [], kept: [], applied: false,
  }
  const names = { merged: merged.name, survivor: survivor.name }

  return withAppStateKeyLock('deed_contacts', async () => {
    // ── 1. Tables ──────────────────────────────────────────────────────────
    const columns = await contactColumns()
    const tableCounts: Array<Column & { count: number }> = []
    for (const c of columns) {
      const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM ${q(c.table)} WHERE ${q(c.column)}::text = $1`, mergedId)
      const n = Number(rows[0]?.n ?? 0)
      if (n) tableCounts.push({ ...c, count: n })
    }

    // ── 2. Lists ───────────────────────────────────────────────────────────
    const state = await loadAppState()
    const listChanges: Record<string, string> = {}
    for (const [key, value] of Object.entries(state)) {
      if (key === 'deed_contacts' || LIST_ONLY_SKIP.has(key) || !value || typeof value !== 'object') continue
      const r = relinkContact(value, mergedId, survivorId, names)
      if (!r.count) continue
      listChanges[key] = JSON.stringify(r.value)
      addArea(outcome.areas, collectionLabel(key), r.count)
    }

    if (!params.apply) {
      for (const t of tableCounts) addArea(outcome.areas, tableLabel(t.table), t.count)
      outcome.filled = Object.keys(blanksToFill(clientToContact(survivor) as never, clientToContact(merged) as never))
      outcome.total = outcome.areas.reduce((s, a) => s + a.count, 0)
      outcome.areas.sort((a, b) => b.count - a.count)
      return outcome
    }

    await prisma.$transaction(async tx => {
      for (const t of tableCounts) {
        await tx.$executeRawUnsafe('SAVEPOINT contact_merge')
        try {
          const moved = await tx.$executeRawUnsafe(
            `UPDATE ${q(t.table)} SET ${q(t.column)} = $1 WHERE ${q(t.column)}::text = $2`,
            // Cast through the column's own type (uuid or text).
            survivorId, mergedId,
          )
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT contact_merge')
          addArea(outcome.areas, tableLabel(t.table), Number(moved) || 0)
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT contact_merge')
          const code = (error as { code?: string; meta?: { code?: string } })?.meta?.code ?? (error as { code?: string })?.code
          // A one-per-contact row the survivor already has: leave it on the archived contact.
          if (String(code).includes('23505') || /unique/i.test(String((error as Error)?.message))) addArea(outcome.kept, tableLabel(t.table), t.count)
          else throw error
        }
      }
      await tx.client.update({
        where: { id: mergedId },
        data: {
          isActive: false,
          notes: [merged.notes, `Merged into ${survivor.name} (${survivorId}) on ${new Date().toISOString().slice(0, 10)}`].filter(Boolean).join('\n'),
        },
      })
    }, { timeout: 120_000 })

    if (Object.keys(listChanges).length) await saveStoreKeys(listChanges)

    const fill = blanksToFill(clientToContact(survivor) as never, clientToContact(merged) as never)
    if (Object.keys(fill).length) {
      await updateContactById(prisma as never, survivorId, fill as never, params.userId).catch(err =>
        console.error('[contact-merge] could not copy details to the survivor:', err instanceof Error ? err.message : err))
    }
    outcome.filled = Object.keys(fill)
    outcome.total = outcome.areas.reduce((s, a) => s + a.count, 0)
    outcome.areas.sort((a, b) => b.count - a.count)
    outcome.applied = true

    void broadcastContacts(prisma as never)
    await writeFinancialAudit({
      userId: params.userId,
      action: 'contact_merged',
      entityType: 'client',
      entityId: survivorId,
      oldValues: { mergedId, mergedName: merged.name },
      newValues: { survivorId, survivorName: survivor.name, moved: outcome.areas, kept: outcome.kept, filled: outcome.filled },
    }).catch(() => {})
    return outcome
  })
}
