const ARRAY_STORE_KEYS = [
  'deed_products',
  'deed_saleOrders',
  'deed_invoices',
  'deed_repairs_v2',
  'deed_expenses',
  'deed_deposits',
  'deed_contacts',
  'deed_accounts',
  'deed_bankAccounts',
  'deed_serials',
  'deed_bulkStock',
  'deed_posOrders',
  'deed_purchaseOrders',
  'deed_payrollRuns',
  'deed_stockTransfers',
  'deed_kilimallOrders',
  'deed_outsourceJobs',
  'deed_refurbishmentJobs',
  'deed_journalEntries',
  'deed_bankStatementLines',
] as const

/**
 * Runs before the client application hydrates. A stale tab can carry an old
 * localStorage payload whose shape no longer matches the current store. The
 * dashboard performs array operations immediately, so one malformed cached
 * value can take down the whole route before the normal recovery UI can help.
 *
 * We only discard keys whose contract is explicitly an array. The server copy
 * remains authoritative and StoreProvider will re-hydrate the missing key.
 */
export default function ClientStoreShapeGuard() {
  const script = `(() => {
    const keys = ${JSON.stringify(ARRAY_STORE_KEYS)};
    const removed = [];
    try {
      for (const key of keys) {
        const raw = window.localStorage.getItem(key);
        if (raw == null) continue;
        try {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) {
            window.localStorage.removeItem(key);
            removed.push(key);
          }
        } catch {
          window.localStorage.removeItem(key);
          removed.push(key);
        }
      }
      if (removed.length) {
        try { window.sessionStorage.removeItem('deed_client_recovered'); } catch {}
        try { window.sessionStorage.removeItem('deed_stale_build_reloaded'); } catch {}
        console.warn('[deed-store-shape-guard] removed malformed cached keys', removed);
      }
    } catch (error) {
      console.warn('[deed-store-shape-guard] skipped', error);
    }
  })();`

  return <script dangerouslySetInnerHTML={{ __html: script }} />
}
