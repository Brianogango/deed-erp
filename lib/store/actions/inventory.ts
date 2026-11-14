// @ts-nocheck -- moved unchanged from the provider, which is not type-checked yet
import { allocateDocNumberSync, allocateDocNumber } from '@/lib/doc-numbers'
import type { OutboundRelease, ItemReleaseStatus, OrcLogEntry, ReleaseStatus, SerialNumber, ProductPriceHistory, Product, StockMove, RefurbishmentJob, RefurbPart, StockAdjustment } from '../inventory'
import { uid, now } from '../ids'
import { sync } from '../sync'
import { inferProductKind, defaultTrackingForKind, defaultUnitForKind } from '@/lib/product-kind'
import { inferTrackingMethod, isSerialTracking, isSerialOnlyCategory } from '@/lib/inventory-identifiers'
import { resolveProductAccounts } from '@/lib/product-accounts'
import { mergeCatalogProducts } from '@/lib/catalog-merge'
import { CATEGORY_CONFIG } from '@/lib/product-categories'
import { canApproveInventoryAction, canManageInventoryControl } from '../permissions'
import { isOpeningStockLocked } from '@/lib/inventory/opening-stock'
import type { LocationId } from '../core'
import { seedSerialSpecs } from '@/lib/reconfiguration/unit-config'
import { isSellableSerial } from '@/lib/inventory/sellable-stock'
import { persistClientStoreValue } from '@/lib/client-store-cache'
import { userCan } from '@/lib/auth/can'
import { isSalesConfirmGatingApproval } from '@/lib/sales-approval-rules'
import { isAssignableTechnician } from '@/lib/repair/assignable-technicians'
import { refurbPartStockTaken } from '@/lib/refurbishment/refurb-parts'
import { userIdsWithRoles } from '@/lib/in-app-notifications'
import { awaitingIdentification } from '@/lib/refurbishment/unidentified'
import { refurbishmentSellingNamePatch } from '@/lib/refurbishment/apply-upgrade-specs'
import { recordsNeedingNumbers, adjustmentsMissingValuation, isProvisionalDocRef } from '@/lib/doc-number-repair'
import type { StockTransfer } from '../purchasing'
import type { AppState } from '../state'
import type { StoreDeps } from './deps'

/** inventory actions of the store. `store` reads the provider's current state, setters and helpers. */
export function createInventoryActions(store: StoreDeps): Pick<AppState, 'addHoldover' | 'updateHoldover' | 'initRelease' | 'pickRelease' | 'verifyReleaseItem' | 'completeVerification' | 'completeRelease' | 'voidRelease' | 'addProduct' | 'normalizeInventoryTags' | 'publishProductBulk' | 'updateProduct' | 'updateProductPrice' | 'archiveProduct' | 'unarchiveProduct' | 'deleteProduct' | 'importOpeningStock' | 'intakeProductSerials' | 'getProductSerials' | 'getAvailableSerials' | 'updateSerial' | 'releaseSerialToStock' | 'getSalesApprovalState' | 'createRefurbishmentJob' | 'assignRefurbishmentJob' | 'updateRefurbishmentJob' | 'addRefurbishmentPart' | 'updateRefurbishmentPart' | 'removeRefurbishmentPart' | 'requestPartFromInventory' | 'allocateRefurbPart' | 'notifyTechPartAvailable' | 'markRefurbishmentReady' | 'transferToSell' | 'writeOffRefurbishmentJob' | 'restoreRefurbishmentJob' | 'fixRefurbJobNumbers' | 'fixAdjustmentNumbers' | 'intakeTaggedMachines' | 'identifyRefurbUnit' | 'harvestRefurbishmentJob' | 'createTransfer' | 'addTransferLine' | 'validateTransfer' | 'submitTransfer' | 'createAdjustment' | 'approveAdjustment' | 'getStockByLocation' | 'getMonthlyMovements' | 'reserveStock' | 'getReservedQty' | 'getAvailableStock' | 'fulfillReservation' | 'cancelReservation'> {
  return {
    addHoldover: (h) => {
        store.setHoldovers(prev => [h, ...prev])
        try { window.localStorage.removeItem('deed_holdovers_v1') } catch { /* ignore */ }
        void store.saveHoldoverToServer('POST', '/api/holdovers', h).then(result => {
          if (typeof result === 'string') {
            store.setHoldovers(prev => prev.filter(x => x.id !== h.id))
            store.showToast(`${h.ref} not saved: ${result}`, 'error')
          } else if (result.ref !== h.ref) {
            // The number was taken by another issue at the same moment.
            store.setHoldovers(prev => prev.map(x => (x.id === h.id ? result : x)))
          }
        })
        store.showToast(`${h.ref} issued to ${h.clientName}`, 'success')
      },

    updateHoldover: (id, patch) => {
        const before = store.holdovers.find(h => h.id === id)
        store.setHoldovers(prev => prev.map(h => (h.id === id ? { ...h, ...patch } : h)))
        void store.saveHoldoverToServer('PATCH', `/api/holdovers/${encodeURIComponent(id)}`, patch).then(result => {
          if (typeof result !== 'string') return
          if (before) store.setHoldovers(prev => prev.map(h => (h.id === id ? before : h)))
          store.showToast(`${before?.ref ?? 'Holdover'} not saved: ${result}`, 'error')
        })
      },

    initRelease: (p) => {
        const user = store.currentUser()
        // The server gives the real number (it replaces this one in the reply).
        const ref = allocateDocNumberSync('ORC')
        const release: OutboundRelease = {
          id: uid(), ref,
          invoiceId: p.invoiceId, repairId: p.repairId, deliveryNoteId: p.deliveryNoteId,
          clientId: p.clientId, clientName: p.clientName,
          sourceRef: p.sourceRef, sourceType: p.sourceType,
          status: 'pending',
          initiatedById: user?.id ?? '', initiatedByName: user?.name ?? '',
          initiatedAt: now(),
          items: p.serials.map(s => ({
            id: uid(), releaseId: '', // filled by setter
            serialNumberId: s.serialNumberId, expectedSerial: s.expectedSerial,
            status: 'picked' as ItemReleaseStatus,
          })),
          auditLog: [{ id: uid(), releaseId: '', action: 'initiated', toStatus: 'pending', performedById: user?.id ?? '', performedByName: user?.name ?? '', performedAt: now() }],
          createdAt: now(), updatedAt: now(),
        }
        // Fix nested releaseId references
        release.items = release.items.map(i => ({ ...i, releaseId: release.id }))
        release.auditLog = release.auditLog.map(l => ({ ...l, releaseId: release.id }))
        store.setOutboundReleases(prev => [release, ...prev])
        fetch('/api/outbound-releases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: release.id,
            ref: release.ref,
            invoiceId: release.invoiceId,
            repairId: release.repairId,
            deliveryNoteId: release.deliveryNoteId,
            clientId: release.clientId,
            serials: release.items.map(item => ({
              id: item.id,
              serialNumberId: item.serialNumberId,
              expectedSerial: item.expectedSerial,
            })),
          }),
        })
          .then(async res => {
            if (!res.ok) return null
            return res.json()
          })
          .then(serverRelease => {
            if (!serverRelease) return
            store.setOutboundReleases(prev => prev.map(item => {
              if (item.id !== release.id) return item
              return {
                ...item,
                ref: serverRelease.ref ?? item.ref,
                items: Array.isArray(serverRelease.items) && serverRelease.items.length
                  ? item.items.map(localItem => {
                      const serverItem = serverRelease.items.find((i: any) => i.id === localItem.id || i.expectedSerial === localItem.expectedSerial)
                      return serverItem ? { ...localItem, id: serverItem.id, releaseId: release.id } : localItem
                    })
                  : item.items,
              }
            }))
          })
          .catch(() => { /* app_state/local release remains available offline */ })
        store.showToast(`Release ${ref} initiated`)
        return release
      },

    pickRelease: (id) => {
        const user = store.currentUser()
        store.setOutboundReleases(prev => prev.map(r => {
          if (r.id !== id || r.status !== 'pending') return r
          const log: OrcLogEntry = { id: uid(), releaseId: id, action: 'all_picked', fromStatus: 'pending', toStatus: 'all_picked', performedById: user?.id ?? '', performedByName: user?.name ?? '', performedAt: now() }
          const updated = { ...r, status: 'all_picked' as ReleaseStatus, updatedAt: now(), auditLog: [...r.auditLog, log] }
          sync(`/api/outbound-releases/${id}/pick`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user?.id }) })
          return updated
        }))
      },

    verifyReleaseItem: (releaseId, itemId, confirmedSerial) => {
        const user = store.currentUser()
        store.setOutboundReleases(prev => prev.map(r => {
          if (r.id !== releaseId) return r
          const items = r.items.map(i => {
            if (i.id !== itemId) return i
            return { ...i, confirmedSerial, serialMatched: confirmedSerial.trim().toLowerCase() === i.expectedSerial.trim().toLowerCase(), status: 'verified' as ItemReleaseStatus, verifiedById: user?.id, verifiedAt: now() }
          })
          return { ...r, items, updatedAt: now() }
        }))
      },

    completeVerification: (id, p) => {
        store.setOutboundReleases(prev => prev.map(r => {
          if (r.id !== id) return r
          const allVerified = r.items.every(i => i.status === 'verified')
          if (!allVerified) { store.showToast('All items must be verified before completing', 'error'); return r }
          const log: OrcLogEntry = { id: uid(), releaseId: id, action: 'verified', fromStatus: r.status, toStatus: 'verified', performedById: p.verifiedById, performedByName: p.verifiedByName, performedAt: now() }
          const updated = { ...r, status: 'verified' as ReleaseStatus, verifiedById: p.verifiedById, verifiedByName: p.verifiedByName, verifiedAt: now(), updatedAt: now(), auditLog: [...r.auditLog, log] }
          sync(`/api/outbound-releases/${id}/verify`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
          // Advance repair to verified_released
          if (r.repairId) {
            store.setRepairs((rs: any[]) => rs.map((rep: any) => rep.id === r.repairId ? { ...rep, status: 'verified_released' } : rep))
          }
          return updated
        }))
      },

    completeRelease: (id, p) => {
        const user = store.currentUser()
        store.setOutboundReleases(prev => prev.map(r => {
          if (r.id !== id || r.status !== 'verified') return r
          if (!p.receivedBy?.trim()) { store.showToast('Received-by name is required', 'error'); return r }
          const hasSignature = !!p.receiverSigData || (p.receiverSigMethod === 'paper' && !!p.receiverSigRef)
          if (!hasSignature) { store.showToast('Receiver signature is required', 'error'); return r }
          const releasedAt = now()
          const log: OrcLogEntry = { id: uid(), releaseId: id, action: 'released', fromStatus: 'verified', toStatus: 'released', performedById: user?.id ?? '', performedByName: user?.name ?? '', performedAt: releasedAt, notes: p.releaseNotes }
          const updated = { ...r, ...p, status: 'released' as ReleaseStatus, releasedAt, updatedAt: releasedAt, items: r.items.map(i => ({ ...i, status: 'released' as ItemReleaseStatus })), auditLog: [...r.auditLog, log] }
          sync(`/api/outbound-releases/${id}/release`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
          // Advance repair to collected
          if (r.repairId) {
            store.setRepairs((rs: any[]) => rs.map((rep: any) => {
              if (rep.id !== r.repairId) return rep
              const updatedRepair = {
                ...rep,
                status: 'collected',
                collectedDate: releasedAt,
                closedDate: releasedAt,
                conditionOnRelease: p.conditionOnRelease ?? rep.conditionOnRelease,
                deliveryRecipient: p.receivedBy,
                deliveryRecipientPhone: p.receivedByPhone,
                notes: p.releaseNotes ? `${rep.notes ? `${rep.notes}\n` : ''}ORC release: ${p.releaseNotes}` : rep.notes,
              }
              store.syncRepairToPortal(updatedRepair, `Device released to ${p.receivedBy}`)
              return updatedRepair
            }))
          }
          store.showToast(`${r.ref} released — items left the building`, 'success')
          return updated
        }))
      },

    voidRelease: (id, reason) => {
        const user = store.currentUser()
        store.setOutboundReleases(prev => prev.map(r => {
          if (r.id !== id || r.status === 'released' || r.status === 'voided') return r
          const log: OrcLogEntry = { id: uid(), releaseId: id, action: 'voided', fromStatus: r.status, toStatus: 'voided', performedById: user?.id ?? '', performedByName: user?.name ?? '', performedAt: now(), notes: reason }
          const updated = { ...r, status: 'voided' as ReleaseStatus, voidedById: user?.id, voidReason: reason, voidedAt: now(), updatedAt: now(), auditLog: [...r.auditLog, log] }
          sync(`/api/outbound-releases/${id}/void`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, userId: user?.id }) })
          if (r.repairId) {
            store.setRepairs((rs: any[]) => rs.map((rep: any) => rep.id === r.repairId && rep.status === 'verified_released' ? { ...rep, status: 'ready' } : rep))
          }
          store.showToast(`${r.ref} voided`)
          return updated
        }))
      },

    // ── Products ─────────────────────────────────────────────────────────────
    addProduct: async (p) => {
        const productKind = inferProductKind({
          productKind: p.productKind,
          trackingMethod: p.trackingMethod,
          category: p.category,
          unit: p.unit,
          requiresSerial: p.requiresSerial,
        })
        const trackingMethod = inferTrackingMethod({
          trackingMethod: p.trackingMethod ?? defaultTrackingForKind(productKind, p.category),
          category: p.category,
          requiresSerial: p.requiresSerial,
          unit: p.unit,
        })
        const accounts = resolveProductAccounts({ ...p, productKind, trackingMethod })
        p = {
          ...p,
          barcode: String(p.barcode ?? '').trim(),
          productKind,
          trackingMethod,
          requiresSerial: isSerialTracking(trackingMethod),
          unit: p.unit || defaultUnitForKind(productKind, trackingMethod),
          saleAccountCode: p.saleAccountCode || accounts.saleAccountCode,
          costAccountCode: p.costAccountCode || accounts.costAccountCode,
          inventoryAccountCode: p.inventoryAccountCode || (productKind === 'storable' ? accounts.inventoryAccountCode : p.inventoryAccountCode),
          cogsAccountCode: p.cogsAccountCode || (productKind === 'storable' ? accounts.cogsAccountCode : p.cogsAccountCode),
          adjustmentAccountCode: p.adjustmentAccountCode || accounts.adjustmentAccountCode,
          writeOffAccountCode: p.writeOffAccountCode || accounts.writeOffAccountCode,
          priceDifferenceAccountCode: p.priceDifferenceAccountCode || accounts.priceDifferenceAccountCode,
        }
        const duplicate = store.findProductIdentityDuplicate(store.prodRef.current, p)
        if (duplicate) {
          if (!duplicate.isActive) {
            store.showToast(`“${duplicate.name}” is archived. Restore it from Products → Status: Archived.`, 'error')
          } else {
            store.showToast(`Product already exists: ${duplicate.name} (${duplicate.sku || duplicate.barcode || 'same name'})`, 'error')
          }
          return null as any
        }
        const lockKey = store.productCreateLockKey(p)
        if (store.productCreateLocksRef.current.has(lockKey)) {
          store.showToast('This product is already being created', 'info')
          return null as any
        }
        store.productCreateLocksRef.current.add(lockKey)
        // Optimistic update — add immediately so the UI responds
        const tempId = uid()
        const optimistic = { ...p, id: tempId, stockQty: 0, createdAt: new Date().toISOString() }
        store.prodRef.current = [...store.prodRef.current, optimistic as any]
        store.setProducts(prev => [...prev, optimistic as any])
  
        // Background sync to database
        try {
          const res = await fetch('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(p),
          })
          if (res.ok) {
            const saved = await res.json()
            // Keep the ERP product shape from the form/import row. The API returns
            // Prisma fields (sellingPrice, reorderLevel, categoryId, etc.), so a
            // raw replacement can drop category/unit/account metadata in local state.
            const reconciled = {
              ...optimistic,
              id: saved.id ?? tempId,
              createdAt: saved.createdAt ?? optimistic.createdAt,
              salePrice: Number(saved.salePrice ?? saved.sellingPrice ?? optimistic.salePrice),
              costPrice: Number(saved.costPrice ?? optimistic.costPrice),
              wholesalePrice: Number(saved.wholesalePrice ?? optimistic.wholesalePrice ?? 0) || 0,
              minStock: Number(saved.minStock ?? saved.reorderLevel ?? optimistic.minStock),
              stockQty: saved.stockQty ?? optimistic.stockQty ?? 0,
              sku: saved.sku || optimistic.sku,
            }
            store.setProducts(prev => prev.map(x => x.id === tempId ? reconciled as any : x))
            store.prodRef.current = store.prodRef.current.map(x => x.id === tempId ? reconciled as any : x)
            store.showToast(`${p.name} created`, 'success')
            // Re-merge catalog so a concurrent SSE wipe cannot drop this product.
            void (async () => {
              try {
                const catalogRes = await fetch('/api/products?lite=1')
                if (!catalogRes.ok) return
                const catalogRows = await catalogRes.json()
                if (!Array.isArray(catalogRows)) return
                store.setProducts(prev => mergeCatalogProducts(prev, catalogRows, CATEGORY_CONFIG) as any)
              } catch { /* ignore */ }
            })()
            return reconciled as any
          }
          const err = await res.json().catch(() => ({}))
          store.setProducts(prev => prev.filter(x => x.id !== tempId))
          store.prodRef.current = store.prodRef.current.filter(x => x.id !== tempId)
          store.showToast(err?.error || err?.message || `Could not create ${p.name}`, 'error')
          return null as any
        } catch {
          store.setProducts(prev => prev.filter(x => x.id !== tempId))
          store.prodRef.current = store.prodRef.current.filter(x => x.id !== tempId)
          store.showToast(`Could not create ${p.name}. Check your connection and try again.`, 'error')
          return null as any
        } finally {
          store.productCreateLocksRef.current.delete(lockKey)
        }
      },

    normalizeInventoryTags: async () => {
        // A legacy heal: once per browser session is plenty (it ran on every
        // Inventory visit).
        try {
          if (window.sessionStorage.getItem('deed_tags_normalized')) return 0
        } catch { /* run it */ }
        try {
          const res = await fetch('/api/inventory/normalize-tags', { method: 'POST' })
          if (!res.ok) return 0
          try { window.sessionStorage.setItem('deed_tags_normalized', '1') } catch { /* optional */ }
          const data = await res.json().catch(() => null)
          const next = Array.isArray(data?.serials) ? data.serials as SerialNumber[] : null
          const rewritten = Number(data?.rewritten ?? 0)
          if (next && rewritten > 0) store.setSerials(next)
          return Number.isFinite(rewritten) ? rewritten : 0
        } catch {
          return 0
        }
      },

    publishProductBulk: async (rows) => {
        const empty = { created: 0, skipped: 0, failed: 0, skippedRows: [] as { name: string; reason: string }[], failedRows: [] as { name: string; reason: string }[] }
        if (!rows.length) return empty
  
        const products = rows.map(row => {
          const productKind = inferProductKind({
            productKind: row.productKind,
            trackingMethod: row.trackingMethod,
            category: row.category,
            unit: row.unit,
            requiresSerial: row.requiresSerial,
          })
          const trackingMethod = inferTrackingMethod({
            trackingMethod: row.trackingMethod ?? defaultTrackingForKind(productKind, row.category),
            category: row.category,
            requiresSerial: row.requiresSerial,
            unit: row.unit,
          })
          return {
            name: row.name,
            sku: (row as any).skuProvided ? row.sku : '',
            skuProvided: !!(row as any).skuProvided,
            barcode: String(row.barcode ?? '').trim(),
            category: row.category,
            productKind,
            trackingMethod,
            productType: (row as any).productType === 'new' ? 'new' : 'refurbished',
            pricingCategoryId: (row as any).pricingCategoryId || undefined,
            salePrice: Number(row.salePrice ?? 0),
            costPrice: Number(row.costPrice ?? 0),
            taxRate: Number(row.taxRate ?? store.companySettings.vatRate ?? 16),
            minStock: Number(row.minStock ?? store.systemSettings.invDefaultMinStock ?? 5),
            unit: row.unit || defaultUnitForKind(productKind, trackingMethod),
            description: row.description || '',
            isActive: true,
            canBeSold: row.canBeSold !== false,
            canBePurchased: row.canBePurchased !== false,
          }
        })
  
        try {
          const res = await fetch('/api/products/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ products }),
          })
          const body = await res.json().catch(() => ({}))
          if (!res.ok) {
            store.showToast(body?.error || body?.message || 'Bulk publish failed', 'error')
            return { ...empty, failed: rows.length, failedRows: [{ name: 'bulk', reason: body?.error || 'Bulk publish failed' }] }
          }
  
          const createdProducts = Array.isArray(body.products) ? body.products : []
          const byName = new Map(rows.map(r => [String(r.name ?? '').trim().toLowerCase(), r]))
  
          // Immediately seed local state from the publish response so the UI
          // shows products even if the follow-up catalog GET is slow/fails.
          if (createdProducts.length > 0) {
            store.setProducts(prev => {
              const asCatalog = createdProducts.map((p: any) => ({
                id: String(p.id),
                sku: p.sku,
                barcode: p.barcode ?? null,
                name: p.name,
                description: p.description ?? null,
                sellingPrice: p.salePrice ?? p.sellingPrice,
                costPrice: p.costPrice,
                reorderLevel: p.minStock ?? p.reorderLevel,
                isActive: p.isActive !== false,
                trackingMethod: p.trackingMethod ?? null,
                invoicePolicy: p.invoicePolicy ?? 'order',
                category: p.category?.name ? p.category : { name: byName.get(String(p.name ?? '').trim().toLowerCase())?.category || 'Laptops' },
              }))
              let merged = mergeCatalogProducts(prev, asCatalog, CATEGORY_CONFIG) as any[]
              merged = merged.map(p => {
                const src = byName.get(String(p.name ?? '').trim().toLowerCase())
                if (!src) return p
                return {
                  ...p,
                  productKind: src.productKind ?? p.productKind,
                  trackingMethod: src.trackingMethod ?? p.trackingMethod,
                  requiresSerial: src.requiresSerial ?? p.requiresSerial,
                  unit: src.unit || p.unit,
                  warrantyMonths: src.warrantyMonths ?? p.warrantyMonths,
                  taxRate: src.taxRate ?? p.taxRate,
                  saleAccountCode: src.saleAccountCode || p.saleAccountCode,
                  costAccountCode: src.costAccountCode || p.costAccountCode,
                  inventoryAccountCode: src.inventoryAccountCode || p.inventoryAccountCode,
                  cogsAccountCode: src.cogsAccountCode || p.cogsAccountCode,
                  adjustmentAccountCode: src.adjustmentAccountCode || p.adjustmentAccountCode,
                  writeOffAccountCode: src.writeOffAccountCode || p.writeOffAccountCode,
                  priceDifferenceAccountCode: src.priceDifferenceAccountCode || p.priceDifferenceAccountCode,
                }
              })
              return merged
            })
          }
  
          // Always re-merge from the relational catalog so published products persist.
          try {
            const catalogRes = await fetch('/api/products?lite=1')
            if (catalogRes.ok) {
              const catalogRows = await catalogRes.json()
              if (Array.isArray(catalogRows)) {
                store.setProducts(prev => {
                  const merged = mergeCatalogProducts(prev, catalogRows, CATEGORY_CONFIG) as any[]
                  return merged.map(p => {
                    const src = byName.get(String(p.name ?? '').trim().toLowerCase())
                    if (!src) return p
                    return {
                      ...p,
                      productKind: src.productKind ?? p.productKind,
                      trackingMethod: src.trackingMethod ?? p.trackingMethod,
                      requiresSerial: src.requiresSerial ?? p.requiresSerial,
                      unit: src.unit || p.unit,
                      warrantyMonths: src.warrantyMonths ?? p.warrantyMonths,
                      taxRate: src.taxRate ?? p.taxRate,
                      saleAccountCode: src.saleAccountCode || p.saleAccountCode,
                      costAccountCode: src.costAccountCode || p.costAccountCode,
                      inventoryAccountCode: src.inventoryAccountCode || p.inventoryAccountCode,
                      cogsAccountCode: src.cogsAccountCode || p.cogsAccountCode,
                      adjustmentAccountCode: src.adjustmentAccountCode || p.adjustmentAccountCode,
                      writeOffAccountCode: src.writeOffAccountCode || p.writeOffAccountCode,
                      priceDifferenceAccountCode: src.priceDifferenceAccountCode || p.priceDifferenceAccountCode,
                    }
                  })
                })
              }
            }
          } catch { /* catalog refresh best-effort after local seed */ }
  
          return {
            created: Number(body.created ?? 0),
            skipped: Number(body.skipped ?? 0),
            failed: Number(body.failed ?? 0),
            skippedRows: Array.isArray(body.skippedRows) ? body.skippedRows : [],
            failedRows: Array.isArray(body.failedRows) ? body.failedRows : [],
          }
        } catch {
          store.showToast('Bulk publish failed. Check your connection and try again.', 'error')
          return { ...empty, failed: rows.length, failedRows: [{ name: 'bulk', reason: 'Network error' }] }
        }
      },

    updateProduct: (id, p) => {
        const duplicate = store.findProductIdentityDuplicate(store.prodRef.current, p, id)
        if (duplicate) {
          store.showToast(`Product already exists: ${duplicate.name} (${duplicate.sku || duplicate.barcode || 'same name'})`, 'error')
          return
        }
        const current = store.prodRef.current.find(product => product.id === id)
        if (!current) return
        const currentTracking = store.getProductTrackingMethod(current)
        const nextCategory = p.category ?? current.category
        const nextTracking = inferTrackingMethod({
          trackingMethod: p.trackingMethod,
          category: nextCategory,
          requiresSerial: p.requiresSerial ?? current.requiresSerial,
          unit: p.unit ?? current.unit,
        })
        if (currentTracking !== nextTracking) {
          // Always allow upgrading machine categories (Laptops…) to SERIAL.
          const serialUpgrade = nextTracking === 'SERIAL' && isSerialOnlyCategory(nextCategory)
          const hasStock =
            store.serialRef.current.some(item => item.productId === id && item.status !== 'sold') ||
            store.bulkStock.some(item => item.productId === id && item.qty > 0)
          const hasTransactions =
            store.saleOrders.some(order => order.lines.some(line => line.productId === id)) ||
            store.purchaseOrders.some(order => order.lines.some(line => line.productId === id)) ||
            store.receipts.some(receipt => receipt.lines.some(line => line.productId === id))
          if (!serialUpgrade && (hasStock || hasTransactions)) {
            store.showToast('Tracking method cannot be changed after stock or transactions exist. Use admin migration flow.', 'error')
            return
          }
        }
        store.setProducts(prev => prev.map(x => {
          if (x.id !== id) return x
          const productKind = inferProductKind({
            productKind: p.productKind ?? x.productKind,
            trackingMethod: nextTracking,
            category: nextCategory,
            unit: p.unit ?? x.unit,
            requiresSerial: p.requiresSerial ?? x.requiresSerial,
          })
          const updated = {
            ...x,
            ...p,
            productKind,
            trackingMethod: nextTracking,
            requiresSerial: isSerialTracking(nextTracking),
            unit: p.unit || defaultUnitForKind(productKind, nextTracking),
          }
          return updated
        }))
        store.showToast('Product master updated')
        fetch(`/api/products/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...p,
            trackingMethod: nextTracking,
            requiresSerial: isSerialTracking(nextTracking),
            category: nextCategory,
          }),
        }).catch(() => {})
      },

    updateProductPrice: (id, salePrice, costPrice, reason, effectiveDate) => {
        const product = store.products.find(p => p.id === id)
        const user = store.currentUser()
        if (!product) { store.showToast('Product not found', 'error'); return null }
        if (salePrice < 0 || costPrice < 0) { store.showToast('Prices cannot be negative', 'error'); return null }
        if (!reason.trim()) { store.showToast('Enter a reason for the price update', 'error'); return null }
        const updatedAt = new Date().toISOString()
        const updatedByName = user?.name ?? user?.username ?? 'System'
        const history: ProductPriceHistory = {
          id: uid(),
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          oldSalePrice: Number(product.salePrice ?? 0),
          newSalePrice: salePrice,
          oldCostPrice: Number(product.costPrice ?? 0),
          newCostPrice: costPrice,
          reason: reason.trim(),
          effectiveDate: effectiveDate || now(),
          updatedById: user?.id,
          updatedByName,
          updatedAt,
        }
        // Catalog price edits update sale price; cost stays purchase-driven unless
        // an explicit cost change is passed (bulk import).
        const patch: Partial<Product> = {
          salePrice,
          costPrice,
          priceUpdatedAt: updatedAt,
          priceUpdatedBy: updatedByName,
        }
        const previous = { salePrice: product.salePrice, costPrice: product.costPrice }
        store.setProducts(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))
        store.setProductPriceHistory(prev => [history, ...prev])
        void fetch(`/api/products/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salePrice, costPrice }),
        }).then(async res => {
          if (res.ok) return
          const payload = await res.json().catch(() => null) as { error?: string } | null
          store.setProducts(prev => prev.map(p => p.id === id ? { ...p, ...previous } : p))
          store.setProductPriceHistory(prev => prev.filter(h => h.id !== history.id))
          store.showToast(payload?.error ?? 'Failed to save sale price on server', 'error')
        }).catch(() => {
          store.showToast('Network error saving sale price', 'error')
        })
        store.addAuditLog('update_product_price', product.sku || product.name, `Price updated for ${product.name}: ${store.fmtKes(history.oldSalePrice)} → ${store.fmtKes(salePrice)}. Reason: ${history.reason}`)
        store.showToast(`Sale price updated for ${product.name}`, 'success')
        return history
      },

    archiveProduct: (id) => {
        if (!canApproveInventoryAction(store.currentUser())) {
          store.showToast('Only inventory approvers can archive products', 'error')
          return
        }
        const product = store.prodRef.current.find(p => p.id === id)
        if (!product) {
          store.showToast('Product not found', 'error')
          return
        }
        if (!product.isActive) {
          store.showToast(`${product.name} is already archived`, 'info')
          return
        }
        const ids = [
          id,
          ...store.prodRef.current.filter(p => p.parentId === id && p.isActive).map(p => p.id),
        ]
        store.setProducts(prev => prev.map(p => ids.includes(p.id) ? { ...p, isActive: false } : p))
        for (const productId of ids) {
          fetch(`/api/products/${productId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: false }),
          }).catch(() => {})
        }
        const extra = ids.length > 1 ? ` (+${ids.length - 1} variant${ids.length === 2 ? '' : 's'})` : ''
        store.addAuditLog('archive_product', product.sku || product.name, `Archived product ${product.name}${extra}`)
        store.showToast(`Archived ${product.name}${extra}. Restore from Products → Status: Archived.`, 'success')
      },

    unarchiveProduct: (id) => {
        if (!canApproveInventoryAction(store.currentUser())) {
          store.showToast('Only inventory approvers can restore archived products', 'error')
          return
        }
        const product = store.prodRef.current.find(p => p.id === id)
        if (!product) {
          store.showToast('Product not found', 'error')
          return
        }
        if (product.isActive) {
          store.showToast(`${product.name} is already active`, 'info')
          return
        }
        // Restoring a variant whose parent is archived — restore parent too so it stays findable.
        const parent = product.parentId ? store.prodRef.current.find(p => p.id === product.parentId) : undefined
        const ids = [
          id,
          ...(parent && !parent.isActive ? [parent.id] : []),
        ]
        store.setProducts(prev => prev.map(p => ids.includes(p.id) ? { ...p, isActive: true } : p))
        for (const productId of ids) {
          fetch(`/api/products/${productId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: true }),
          }).catch(() => {})
        }
        store.addAuditLog('unarchive_product', product.sku || product.name, `Restored product ${product.name}`)
        store.showToast(`Restored ${product.name}`, 'success')
      },

    deleteProduct: (id) => {
        if (!canApproveInventoryAction(store.currentUser())) { store.showToast('Only inventory approvers can delete product masters', 'error'); return }
        const hasStock =
          store.serialRef.current.some(item => item.productId === id && item.status !== 'sold') ||
          store.bulkStock.some(item => item.productId === id && item.qty > 0)
        const hasTransactions =
          store.saleOrders.some(order => order.lines.some(line => line.productId === id)) ||
          store.purchaseOrders.some(order => order.lines.some(line => line.productId === id)) ||
          store.receipts.some(receipt => receipt.lines.some(line => line.productId === id)) ||
          store.invoices.some(invoice => invoice.lines.some(line => line.productId === id))
        if (hasStock || hasTransactions) {
          store.showToast('Cannot delete product master with stock or transactions. Archive it instead.', 'error')
          return
        }
        store.setProducts(p => p.filter(x => x.id !== id))
        store.setBulkStock(p => p.filter(level => level.productId !== id))
        store.showToast('Product deleted')
        fetch(`/api/products/${id}`, { method: 'DELETE' }).catch(() => {})
      },

    importOpeningStock: async (items) => {
        if (!canApproveInventoryAction(store.currentUser())) { store.showToast('Only inventory approvers can post opening stock', 'error'); return }
        if (isOpeningStockLocked(store.openingStockPosted, store.stockMoves)) {
          if (!store.openingStockPosted) store.setOpeningStockPosted(true)
          store.showToast('Opening stock has already been posted and is locked', 'error')
          return
        }
        try {
          const preflightItems = items.map(item => {
            const product = store.prodRef.current.find(x => x.id === item.productId)
            return {
              productId: item.productId,
              productName: product?.name,
              qty: item.qty,
              requiresSerial: Boolean(product?.requiresSerial),
              serials: item.serials ?? [],
              serialSkus: item.serialSkus ?? [],
            }
          })
          const response = await fetch('/api/inventory/validate-opening-stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: preflightItems }),
          })
          if (!response.ok) {
            const payload = await response.json().catch(() => null) as { errors?: string[]; error?: string } | null
            const message = payload?.errors?.[0] || payload?.error || 'Opening stock validation failed'
            store.showToast(message, 'error')
            return
          }
        } catch {
          store.showToast('Could not validate opening stock on server', 'error')
          return
        }
        const newSerials: SerialNumber[] = []
        const stockDeltas = new Map<string, number>()
        const bulkItems: Array<{ productId: string; location: LocationId; qty: number }> = []
        const seenSerials = new Set<string>()
        const reservedUnitSkus = new Set(
          store.serialRef.current.map(item => String(item.sku ?? '').trim().toUpperCase()).filter(Boolean),
        )
  
        for (const item of items) {
          const prod = store.prodRef.current.find(x => x.id === item.productId)
          if (!prod) continue
          const loc = item.location ?? 'warehouse'
          if (prod.requiresSerial && item.serials) {
            if (item.serials.length !== item.qty) {
              store.showToast(`Opening stock for ${prod.name} requires one serial per unit`, 'error')
              return
            }
            if ((item.serialSkus?.length ?? 0) > item.serials.length) {
              store.showToast(`Opening stock for ${prod.name} has more unit SKUs than serial numbers`, 'error')
              return
            }
            const duplicateSerial = item.serials.find(serial => {
              const normalized = serial.trim().toUpperCase()
              if (seenSerials.has(normalized)) return true
              seenSerials.add(normalized)
              return store.serialRef.current.some(existing => existing.serial.trim().toUpperCase() === normalized)
            })
            if (duplicateSerial) {
              store.showToast(`Duplicate serial detected while posting opening stock for ${prod.name}: ${duplicateSerial}`, 'error')
              return
            }
            const serialUnitSkus = item.serials.map((serial, idx) => {
              const unitSku = store.buildSerialUnitSku(prod, serial, item.serialSkus?.[idx], reservedUnitSkus)
              if (reservedUnitSkus.has(unitSku)) return null
              reservedUnitSkus.add(unitSku)
              return unitSku
            })
            const duplicateSkuIndex = serialUnitSkus.findIndex(unitSku => unitSku === null)
            if (duplicateSkuIndex !== -1) {
              store.showToast(`Duplicate unit SKU detected for ${prod.name}: ${item.serialSkus?.[duplicateSkuIndex]}`, 'error')
              return
            }
            item.serials.forEach((s, idx) => {
              const newSerial: SerialNumber = {
                id: uid(),
                serial: s,
                sku: serialUnitSkus[idx]!,
                productId: item.productId,
                productName: prod.name,
                location: loc,
                status: 'available',
                receivedDate: now(),
                // Internal inventory barcode is distinct from manufacturer serial.
                barcode: store.buildInventoryBarcodeForProduct(item.productId, s),
                specs: seedSerialSpecs({
                  productName: prod.name,
                  deviceConfig: prod.deviceConfig,
                }),
              }
              newSerials.push(newSerial)
            })
            stockDeltas.set(item.productId, (stockDeltas.get(item.productId) ?? 0) + item.serials.length)
          } else {
            bulkItems.push({ productId: item.productId, location: loc, qty: item.qty })
            stockDeltas.set(item.productId, (stockDeltas.get(item.productId) ?? 0) + item.qty)
          }
        }
  
        if (newSerials.length > 0) {
          store.setSerials(prev => {
            const have = new Set(prev.map(s => s.id))
            const fresh = newSerials.filter(s => !have.has(s.id))
            return fresh.length ? [...prev, ...fresh] : prev
          })
        }
        if (bulkItems.length > 0) {
          store.setBulkStock(prev => bulkItems.reduce(
            (next, item) => store.upsertBulkStock(next, item.productId, item.location, item.qty),
            prev,
          ))
        }
        if (stockDeltas.size > 0) {
          store.setProducts(prev => prev.map(product => {
            const delta = stockDeltas.get(product.id)
            return delta ? { ...product, stockQty: product.stockQty + delta } : product
          }))
        }
        items.forEach(item => {
          const prod = store.prodRef.current.find(x => x.id === item.productId)
          if (!prod) return
          const loc = item.location ?? 'warehouse'
          if (prod.requiresSerial && item.serials) {
            store.addMove(item.productId, prod.name, item.serials.length, 'in', 'Opening stock', 'OPENING', undefined, loc, item.serials)
          } else {
            store.addMove(item.productId, prod.name, item.qty, 'in', 'Opening stock', 'OPENING', undefined, loc)
          }
        })
        store.setOpeningStockPosted(true)
        // Seed Prisma valuation + opening STK journal (non-blocking).
        void fetch('/api/inventory/post-opening-valuation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reference: 'OPENING',
            items: items.map(item => {
              const prod = store.prodRef.current.find(x => x.id === item.productId)
              return {
                productId: item.productId,
                qty: item.qty,
                unitCost: Number(prod?.costPrice) || 0,
              }
            }),
          }),
        }).catch(() => { /* soak-safe */ })
        store.addAuditLog('opening_stock', 'OPENING', `Opening stock posted — ${items.length} product(s)`)
        store.showToast('Opening stock posted · locked against further changes')
      },

    intakeProductSerials: async (productId, input) => {
        const product = store.prodRef.current.find(p => p.id === productId)
        if (!product) { store.showToast('Product not found', 'error'); return null }
        const serials = (input.serials ?? []).map(s => String(s).trim()).filter(Boolean)
        if (serials.length === 0) { store.showToast('Enter at least one serial number', 'error'); return null }
        if (!String(input.reason ?? '').trim()) { store.showToast('Reason is required', 'error'); return null }
  
        try {
          const res = await fetch('/api/inventory/intake-serials', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              productId,
              serials,
              location: input.location ?? 'warehouse',
              reason: input.reason,
              kind: input.kind,
            }),
          })
          const data = await res.json().catch(() => ({})) as {
            error?: string
            errors?: string[]
            added?: number
            documentRef?: string
            serials?: SerialNumber[]
            move?: StockMove
            product?: Partial<Product>
          }
          if (!res.ok) {
            store.showToast(data.errors?.[0] || data.error || 'Could not add serials', 'error')
            return null
          }
  
          if (Array.isArray(data.serials) && data.serials.length > 0) {
            store.setSerials(prev => {
              const existingIds = new Set(prev.map(s => s.id))
              const incoming = data.serials!.filter(s => !existingIds.has(s.id))
              return incoming.length ? [...incoming, ...prev] : prev
            })
          }
          if (data.move) {
            store.setStockMoves(prev => (prev.some(m => m.id === data.move!.id) ? prev : [data.move!, ...prev]))
          }
          if (data.product) {
            store.setProducts(prev => prev.map(p => p.id === productId
              ? {
                  ...p,
                  requiresSerial: true,
                  trackingMethod: 'SERIAL',
                  stockQty: typeof data.product!.stockQty === 'number' ? data.product!.stockQty : p.stockQty + (data.added ?? serials.length),
                }
              : p))
          }
  
          const docRef = data.documentRef || 'INTK'
          store.addAuditLog(
            'serial_intake',
            docRef,
            `Added ${data.added ?? serials.length} on-hand serial(s) to ${product.name} @ ${input.location ?? 'warehouse'}: ${serials.join(', ')}`,
          )
          store.showToast(`Added ${data.added ?? serials.length} serial(s) — On hand updated (${docRef})`, 'success')
          return { added: data.added ?? serials.length, documentRef: docRef }
        } catch {
          store.showToast('Could not reach server to add serials', 'error')
          return null
        }
      },

    // ── Serials ───────────────────────────────────────────────────────────────
    getProductSerials: (productId, location) =>
        store.serialRef.current.filter(s => s.productId === productId && (!location || s.location === location)),

    getAvailableSerials: (productId) =>
        store.serialRef.current.filter(s => s.productId === productId && isSellableSerial(s)),

    updateSerial: (id, patch, opts) => {
        // Server-authoritative flows (notably reconfiguration completion) need
        // to refresh the client cache without scheduling useLS's debounced
        // app_state write back to the server. Feed the value through the same
        // remote-update channel used by SSE; useLS marks that update as
        // skipNextSync, so stale client fields cannot overwrite the completed
        // server record.
        if (opts?.persist === false && typeof window !== 'undefined') {
          const next = store.serialRef.current.map(s => s.id === id ? { ...s, ...patch } : s)
          const serialized = JSON.stringify(next)
          try {
            persistClientStoreValue('deed_serials', serialized)
          } catch { /* local cache is best-effort */ }
          window.dispatchEvent(new CustomEvent('deed_remote_update', {
            detail: { key: 'deed_serials', value: serialized },
          }))
          return
        }
  
        store.setSerials(p => {
          const next = p.map(s => s.id === id ? { ...s, ...patch } : s)
          const updated = next.find(s => s.id === id)
          if (updated) {
            sync(`/api/serials/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updated),
            })
          }
          return next
        })
      },

    releaseSerialToStock: (serialId, destination = 'warehouse') => {
        const user = store.currentUser()
        if (!userCan(user, 'inventory.serials.release')) {
          store.showToast('Only Inventory, Admin Officer or Director can release held serials', 'error')
          return false
        }
        const serial = store.serialRef.current.find(s => s.id === serialId)
        if (!serial) { store.showToast('Serial not found', 'error'); return false }
        if (serial.status === 'available') {
          store.showToast('Serial is already available on hand', 'info')
          return false
        }
        if (serial.status === 'sold') {
          store.showToast('Sold serials must be returned via buyback, exchange or RMA — not released directly', 'error')
          return false
        }
        if (!['assigned', 'returned'].includes(serial.status)) {
          store.showToast(`Cannot release serial with status “${serial.status.replace(/_/g, ' ')}”`, 'error')
          return false
        }
  
        // Detach from any open SO line that still holds this serial id.
        store.setSaleOrders(prev => prev.map(so => {
          const touched = so.lines.some(l => (l.serialIds || []).includes(serialId))
          if (!touched) return so
          const lines = so.lines.map(l => ({
            ...l,
            serialIds: (l.serialIds || []).filter(id => id !== serialId),
          }))
          const updated = { ...so, lines }
          sync(`/api/sale-orders/${so.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
          return updated
        }))
  
        const dest: LocationId = (['warehouse', 'shop', 'repair_unit'] as LocationId[]).includes(destination)
          ? destination
          : 'warehouse'
        const nextSerial: SerialNumber = {
          ...serial,
          status: 'available',
          location: dest,
          saleOrderId: undefined,
          repairId: undefined,
          soldDate: undefined,
        }
        store.setSerials(p => {
          const next = p.map(s => s.id === serialId ? nextSerial : s)
          sync(`/api/serials/${serialId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nextSerial) })
          return next
        })
        store.addAuditLog(
          'serial_release',
          serial.serial,
          `Released ${serial.serial} from ${serial.status} → available @ ${dest} by ${user.name}`,
        )
        store.showToast(`${serial.serial} returned to on-hand (available)`, 'success')
        return true
      },

    getSalesApprovalState: (documentId: string) => {
        const requests = store.approvalRequests.filter(r =>
          r.documentId === documentId && isSalesConfirmGatingApproval(r.type, store.systemSettings),
        )
        if (requests.length === 0) return { status: 'not_required', requests }
        if (requests.some(r => r.status === 'rejected')) return { status: 'rejected', requests }
        if (requests.some(r => r.status === 'pending')) return { status: 'pending', requests }
        return { status: 'approved', requests }
      },

    // ── Refurbishment ──────────────────────────────────────────────────────────
    createRefurbishmentJob: (serialId, issueDescription, opts) => {
        const ser = store.serialRef.current.find(s => s.id === serialId)
        if (!ser) { store.showToast('Serial not found', 'error'); return }
        const x = ser as SerialNumber & { identityPending?: boolean; intakeTag?: string; intakeCost?: number; intakeIssue?: string }
        const prod = store.prodRef.current.find(p => p.id === ser.productId)
        const job: RefurbishmentJob = {
          id: uid(), ref: allocateDocNumberSync('REF'),
          status: 'queued',
          serialId, serialNumber: ser.serial,
          productId: ser.productId, productName: ser.productName,
          specs: ser.specs || (x.identityPending ? '' : prod?.description),
          specsAtIntake: ser.specs || (x.identityPending ? '' : prod?.description || ''),
          intakeDate: new Date().toISOString(),
          // What was noted when it came in, unless a reason is given now.
          intakeIssueDescription: issueDescription || x.intakeIssue || '',
          partsNeeded: [],
          // A machine from With Issues keeps its tag and intake cost on the job.
          ...(x.identityPending ? { identityPending: true, intakeTag: x.intakeTag || ser.serial } : {}),
          ...(x.intakeCost != null ? { intakeCost: x.intakeCost } : {}),
          ...(ser.location === 'shop' ? { intakeSource: 'stock' as const, intakeSourceRef: 'With Issues' } : {}),
        }
        // Move serial to repair_unit with refurbishment status
        store.setSerials(p => p.map(s => s.id === serialId ? { ...s, location: 'repair_unit', status: 'refurbishment' } : s))
        store.setRefurbishmentJobs(p => [...p, job])
        store.numberRefurbJobs([job.id])
        if (!opts?.silent) store.showToast('Refurbishment job created')
      },

    assignRefurbishmentJob: (jobId, techId, techName) => {
        const job = store.refurbishmentJobs.find(j => j.id === jobId)
        const tech = store.users.find(u => u.id === techId)
        const exitedEmployeeIds = new Set(store.empRef.current.filter(e => e.status === 'exited').map(e => e.id))
        if (!tech || !isAssignableTechnician(tech, exitedEmployeeIds)) {
          store.showToast('Cannot assign an inactive or exited technician', 'error'); return
        }
        store.setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : { ...j, assignedTechnicianId: techId, assignedTechnicianName: techName, assignedDate: now(), status: 'assigned' }))
        if (job) {
          store.notifyUsers({
            recipients: [techId],
            type: 'assignment',
            title: 'Refurbishment job assigned',
            body: `${job.productName} (${job.serialNumber}) has been assigned to you for refurbishment.`,
            module: 'refurbishment',
            path: '?tab=refurb',
            icon: '🔧',
            entityKey: `refurb:${jobId}:assigned`,
            excludeUserId: store.currentUserId,
          })
        }
        store.showToast(`Job assigned to ${techName}`)
      },

    updateRefurbishmentJob: (jobId, patch) => {
        store.setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : {
          ...j,
          ...patch,
          ...(patch.status === 'in_progress' && !j.startedDate ? { startedDate: now() } : {}),
        }))
      },

    addRefurbishmentPart: (jobId, part, opts) => {
        const newPart: RefurbPart = { ...part, id: uid() }
        store.setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : { ...j, partsNeeded: [...j.partsNeeded, newPart] }))
        // The part is not in this render's job list yet, so it is passed along.
        if (opts?.request && newPart.productId) store.storeCtx.requestPartFromInventory(jobId, newPart.id, newPart)
      },

    updateRefurbishmentPart: (jobId, partId, patch) => {
        // Fitting a part that never left stock (ordered and received on a PO,
        // then flagged ready): it comes out of the warehouse now. It used to be
        // marked used while staying in stock.
        if (patch.status === 'used') {
          const job = store.refurbishmentJobs.find(j => j.id === jobId)
          const part = job?.partsNeeded.find(pt => pt.id === partId)
          if (job && part && part.productId && !refurbPartStockTaken(part)) {
            if (!store.takeRefurbPartFromWarehouse(job, part, store.currentUser()?.name ?? 'Technician')) return
            patch = { ...patch, stockTaken: true }
          }
        }
        store.setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : { ...j, partsNeeded: j.partsNeeded.map(pt => pt.id !== partId ? pt : { ...pt, ...patch }) }))
      },

    removeRefurbishmentPart: (jobId, partId) => {
        store.setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : { ...j, partsNeeded: j.partsNeeded.filter(pt => pt.id !== partId) }))
      },

    requestPartFromInventory: (jobId, partId, given) => {
        const job  = store.refurbishmentJobs.find(j => j.id === jobId)
        const part = given ?? job?.partsNeeded.find(p => p.id === partId)
        if (!job || !part || !part.productId) { store.showToast('Part must be linked to an inventory product first', 'error'); return }
        const prod = store.prodRef.current.find(p => p.id === part.productId)
        // Only good stock in the warehouse counts: the product's total also
        // holds units With Issues and in the repair unit.
        if (store.refurbWarehouseQty(part.productId) >= part.qty) {
          if (!store.takeRefurbPartFromWarehouse(job, part, 'Auto (stock available)')) return
          store.setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : {
            ...j, partsNeeded: j.partsNeeded.map(pt => pt.id !== partId ? pt : {
              ...pt, status: 'allocated', allocatedDate: now(), allocatedByName: 'Auto (stock available)', requestedDate: now(), stockTaken: true,
            })
          }))
          store.showToast(`Part allocated from stock — ${prod?.name ?? part.partName} × ${part.qty}`)
        } else {
          // Not enough stock: the desk orders it (Inventory › Parts requests); the job carries on.
          store.setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : {
            ...j, partsNeeded: j.partsNeeded.map(pt => pt.id !== partId ? pt : {
              ...pt, status: 'requested', requestedDate: now(), requestedByName: store.currentUser()?.name,
            })
          }))
          store.notifyUsers({
            recipientRoles: ['technical_lead', 'inventory_officer'],
            recipients: userIdsWithRoles(store.users, ['technical_lead', 'inventory_officer'], store.currentUserId),
            type: 'repair',
            title: 'Part requested for refurb job',
            body: `${job.ref} — ${part.partName} × ${part.qty} (out of stock). Order it in Inventory › Parts requests.`,
            module: 'refurbishment',
            path: '?tab=refurb',
            icon: '🔧',
            entityKey: `refurb:${jobId}:part:${partId}:oos`,
            excludeUserId: store.currentUserId,
          })
          store.showToast(`Part requested — lead tech alerted to avail or order: ${part.partName} × ${part.qty}`, 'info')
        }
      },

    allocateRefurbPart: (jobId, partId) => {
        const user = store.currentUser(); if (!user) return
        const job  = store.refurbishmentJobs.find(j => j.id === jobId)
        const part = job?.partsNeeded.find(p => p.id === partId)
        if (!job || !part || !part.productId) { store.showToast('No linked product — cannot allocate from inventory', 'error'); return }
        if (!store.takeRefurbPartFromWarehouse(job, part, user.name)) return
        store.setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : {
          ...j, partsNeeded: j.partsNeeded.map(pt => pt.id !== partId ? pt : {
            ...pt, status: 'allocated', allocatedDate: now(), allocatedByName: user.name, stockTaken: true,
          })
        }))
        store.showToast(`Part allocated from stock by ${user.name}`)
      },

    notifyTechPartAvailable: (jobId, partId) => {
        const user = store.currentUser(); if (!user) return
        const job = store.refurbishmentJobs.find(j => j.id === jobId)
        const part = job?.partsNeeded.find(pt => pt.id === partId)
        store.setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : {
          ...j, partsNeeded: j.partsNeeded.map(pt => pt.id !== partId ? pt : {
            ...pt, status: 'received', notifiedTechDate: now(), allocatedByName: user.name,
          })
        }))
        if (job?.assignedTechnicianId) {
          store.notifyUsers({
            recipients: [job.assignedTechnicianId],
            type: 'assignment',
            title: 'Part ready for your refurb job',
            body: `${job.ref} — ${part?.partName ?? 'Part'} is available and ready to use.`,
            module: 'refurbishment',
            path: '?tab=refurb',
            icon: '📦',
            entityKey: `refurb:${jobId}:part:${partId}:ready`,
            excludeUserId: user.id,
          })
        }
        store.showToast('Technician notified — part is ready for use')
      },

    markRefurbishmentReady: (jobId) => {
        const job = store.refurbishmentJobs.find(j => j.id === jobId)
        if (!job) return
        if (job.identityPending || awaitingIdentification(store.serialRef.current.find(s => s.id === job.serialId))) {
          store.showToast(`Identify ${job.serialNumber} first: record its real serial and model.`, 'error'); return
        }
        // A machine is not ready while parts are still on their way, or were
        // taken for it and never fitted (mark them used, or remove them).
        const waiting = job.partsNeeded.filter(p => p.status === 'requested' || p.status === 'ordered')
        const unfitted = job.partsNeeded.filter(p => p.status === 'allocated' || p.status === 'received')
        if (waiting.length || unfitted.length) {
          const list = (ps: RefurbPart[]) => ps.map(p => p.partName).join(', ')
          store.showToast(waiting.length
            ? `Still waiting for parts: ${list(waiting)}. Remove them if they are no longer needed.`
            : `Mark the fitted parts as used first: ${list(unfitted)} (or remove them).`, 'error')
          return
        }
        const serial = store.serialRef.current.find(s => s.id === job.serialId)
        const upgrade = refurbishmentSellingNamePatch({
          job,
          serial,
          products: store.prodRef.current,
        })
        const intake = typeof job.specsAtIntake === 'string'
          ? job.specsAtIntake
          : (job.specs || serial?.specs || '')
        store.setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : {
          ...j,
          status: 'ready',
          completedDate: now(),
          specsAtIntake: typeof j.specsAtIntake === 'string' ? j.specsAtIntake : intake,
          ...(upgrade ? { specs: upgrade.specs, productName: upgrade.sellingName } : {}),
        }))
        if (upgrade) {
          store.setSerials(p => p.map(s => s.id === job.serialId ? { ...s, specs: upgrade.specs } : s))
          store.showToast(`Ready to sell as ${upgrade.sellingName}. Reprint the serial label.`)
          return
        }
        store.showToast(`${job.serialNumber} marked as ready — transfer to sales when needed`)
      },

    transferToSell: (jobId) => {
        const job = store.refurbishmentJobs.find(j => j.id === jobId)
        if (!job) return
        if (job.identityPending || awaitingIdentification(store.serialRef.current.find(s => s.id === job.serialId))) {
          store.showToast(`Identify ${job.serialNumber} first: record its real serial and model.`, 'error'); return
        }
        const serial = store.serialRef.current.find(s => s.id === job.serialId)
        const intake = typeof job.specsAtIntake === 'string'
          ? job.specsAtIntake
          : (job.specs || serial?.specs || '')
        const upgrade = refurbishmentSellingNamePatch({
          job: { ...job, specsAtIntake: intake },
          serial,
          products: store.prodRef.current,
        })
        // A repaired device is retested before it can be sold: it goes back to
        // Inbound › Awaiting tests, and only a pass there makes it Ready for Sale.
        store.setSerials(p => p.map(s => s.id !== job.serialId ? s : {
          ...s,
          status: 'available',
          location: 'pending_testing',
          ...(upgrade ? { specs: upgrade.specs } : {}),
        }))
        store.setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : {
          ...j,
          status: 'transferred',
          transferDate: now(),
          specsAtIntake: typeof j.specsAtIntake === 'string' ? j.specsAtIntake : intake,
          ...(upgrade ? { specs: upgrade.specs, productName: upgrade.sellingName } : {}),
        }))
        if (upgrade) {
          store.showToast(`${job.serialNumber} sent for retest — selling name is now ${upgrade.sellingName}`)
          return
        }
        store.showToast(`${job.serialNumber} sent for retest — pass it in Inventory › Warehouse › Inbound to make it sellable`)
      },

    writeOffRefurbishmentJob: async (jobId, reason) => {
        const job = store.refurbishmentJobs.find(j => j.id === jobId)
        if (!job) return false
        // The server writes the device off: out of stock, and its cost booked
        // as a write-off expense instead of staying in inventory.
        let cost = 0
        let valuationRef: string | undefined
        try {
          const res = await fetch('/api/inventory/serial-write-off', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serialId: job.serialId, action: 'write_off', reference: job.ref, reason }),
          })
          const data = await res.json().catch(() => null) as { error?: string; cost?: number; valuationRef?: string } | null
          if (!res.ok) { store.showToast(data?.error || 'Could not write the device off', 'error'); return false }
          cost = Number(data?.cost) || 0
          valuationRef = data?.valuationRef
        } catch {
          store.showToast('Could not write the device off. Check your connection and try again.', 'error')
          return false
        }
        // Parts taken from stock for this machine and not fitted go back to the
        // warehouse; they used to stay out of stock for good.
        const returned = job.partsNeeded.filter(p => p.productId && p.status !== 'used' && refurbPartStockTaken(p))
        for (const p of returned) store.returnRefurbPartToWarehouse(job, p)
        const returnedIds = new Set(returned.map(p => p.id))
        store.setSerials(p => p.map(s => s.id !== job.serialId ? s : { ...s, status: 'written_off' }))
        store.setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : {
          ...j,
          status: 'written_off',
          techNotes: (j.techNotes ? j.techNotes + '\n' : '') + `Written off: ${reason}`,
          completedDate: now(),
          writeOffCost: cost,
          writeOffValuationRef: valuationRef,
          partsNeeded: j.partsNeeded.map(pt => returnedIds.has(pt.id)
            ? { ...pt, status: 'needed' as const, stockTaken: false, allocatedDate: undefined, allocatedByName: undefined, notifiedTechDate: undefined, notes: [pt.notes, 'Returned to stock on write-off'].filter(Boolean).join(' · ') }
            : pt),
        }))
        store.addAuditLog('refurb_write_off', job.ref, `Written off ${job.serialNumber}${cost ? ` (KES ${cost.toLocaleString('en-KE')} to write-off expense)` : ''}: ${reason}`)
        store.showToast([
          `${job.serialNumber} written off`,
          cost ? `KES ${cost.toLocaleString('en-KE')} booked as a write-off` : '',
          returned.length ? `${returned.length} unused part${returned.length > 1 ? 's' : ''} returned to stock` : '',
        ].filter(Boolean).join(' — '))
        return true
      },

    restoreRefurbishmentJob: async (jobId) => {
        const job = store.refurbishmentJobs.find(j => j.id === jobId)
        if (!job || job.status !== 'written_off') return false
        if (job.outcome === 'harvested') { store.showToast('A machine stripped for parts cannot be brought back.', 'error'); return false }
        try {
          const res = await fetch('/api/inventory/serial-write-off', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              serialId: job.serialId,
              action: 'restore',
              reference: job.ref,
              reason: 'Brought back to refurbishment',
              // Only what this write-off took off the books is put back.
              ...(job.writeOffCost ? { unitCost: job.writeOffCost } : {}),
              restoreTo: { status: 'refurbishment', location: 'repair_unit' },
            }),
          })
          const data = await res.json().catch(() => null) as { error?: string } | null
          if (!res.ok) { store.showToast(data?.error || 'Could not bring the device back', 'error'); return false }
        } catch {
          store.showToast('Could not bring the device back. Check your connection and try again.', 'error')
          return false
        }
        store.setSerials(p => p.map(s => s.id !== job.serialId ? s : { ...s, status: 'refurbishment', location: 'repair_unit' }))
        // Back to its technician when it had one: a queued job with a
        // technician set could not be started (Start needs "assigned").
        store.setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : {
          ...j,
          status: j.assignedTechnicianId ? 'assigned' : 'queued',
          completedDate: undefined,
          writeOffCost: undefined,
          writeOffValuationRef: undefined,
          techNotes: (j.techNotes ? j.techNotes + '\n' : '') + `Restored from write-off on ${new Date().toLocaleDateString('en-GB')}`,
        }))
        store.addAuditLog('refurb_restore', job.ref, `Restored ${job.serialNumber} from write-off${job.writeOffCost ? ` (KES ${job.writeOffCost.toLocaleString('en-KE')} write-off reversed)` : ''}`)
        store.showToast([
          job.assignedTechnicianName ? `Device restored — back with ${job.assignedTechnicianName}` : 'Device restored to queue',
          job.writeOffCost ? `KES ${job.writeOffCost.toLocaleString('en-KE')} write-off reversed` : '',
        ].filter(Boolean).join(' — '))
        return true
      },

    fixRefurbJobNumbers: () => {
        const ids = store.refurbJobsNeedingNumbers(store.refurbishmentJobs)
        store.numberRefurbJobs(ids)
        return ids.length
      },

    fixAdjustmentNumbers: () => {
        const ids = recordsNeedingNumbers(store.stockAdjustments, { dateOf: a => a.date })
        store.numberAdjustments(ids)
        const missingValuation = adjustmentsMissingValuation(store.stockAdjustments)
          .map(a => ({ id: a.id, ref: a.ref, formerRef: a.formerRef, productName: a.productName, type: a.type, qty: a.qty }))
        return { renumbered: ids.length, missingValuation }
      },

    intakeTaggedMachines: async (input) => {
        try {
          const res = await fetch('/api/refurbishment/intake', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: input.productId, units: input.units.map(u => ({ cost: u.cost, note: u.note, issue: u.issue, serial: u.serial, assetId: u.assetId, productId: u.productId })), from: input.from, reference: input.reference, destination: input.destination }),
          })
          const data = await res.json().catch(() => null) as { error?: string; serials?: SerialNumber[]; costs?: number[] } | null
          if (!res.ok || !data?.serials) { store.showToast(data?.error || 'Could not take the machines in', 'error'); return null }
          const created = data.serials
          store.setSerials(p => [...p.filter(s => !created.some(c => c.id === s.id)), ...created])
          const assets = created.map(c => (c as SerialNumber & { assetId?: string }).assetId || c.serial)
          if (input.destination === 'with_issues') {
            store.addAuditLog('with_issues_intake', input.reference || assets[0] || '', `Took in ${created.length} machine(s) With Issues: ${assets.join(', ')}`)
            store.showToast(`${created.length} machine${created.length === 1 ? '' : 's'} in With Issues: ${assets[0]}${created.length > 1 ? ` … ${assets[assets.length - 1]}` : ''}. Print the stickers.`)
            return assets
          }
          const source: RefurbishmentJob['intakeSource'] = input.from ? 'stock' : 'unrecorded'
          const jobs: RefurbishmentJob[] = created.map((ser, i) => ({
            id: uid(), ref: allocateDocNumberSync('REF'),
            status: 'queued',
            serialId: ser.id, serialNumber: ser.serial,
            productId: ser.productId, productName: ser.productName,
            specs: '', specsAtIntake: '',
            intakeDate: new Date().toISOString(),
            // The technician records what is wrong once they open it up.
            intakeIssueDescription: input.units[i]?.issue || '',
            partsNeeded: [],
            ...((ser as SerialNumber & { identityPending?: boolean }).identityPending ? { identityPending: true, intakeTag: ser.serial } : {}),
            intakeCost: data.costs?.[i],
            intakeSource: source,
            intakeSourceRef: input.reference,
          }))
          store.setRefurbishmentJobs(p => [...p, ...jobs])
          store.numberRefurbJobs(jobs.map(j => j.id))
          store.addAuditLog('refurb_tagged_intake', input.reference || jobs[0]?.ref || '', `Took in ${created.length} machine(s) without serial: ${created.map(c => c.serial).join(', ')}`)
          store.showToast(`${created.length} machine${created.length === 1 ? '' : 's'} queued for refurbishment: ${assets[0]}${created.length > 1 ? ` … ${assets[assets.length - 1]}` : ''}. Print the stickers.`)
          return assets
        } catch {
          store.showToast('Could not take the machines in. Check your connection and try again.', 'error')
          return null
        }
      },

    identifyRefurbUnit: async (jobId, input) => {
        const job = store.refurbishmentJobs.find(j => j.id === jobId)
        if (!job) return false
        try {
          const res = await fetch('/api/refurbishment/identify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serialId: job.serialId, ...input }),
          })
          const data = await res.json().catch(() => null) as { error?: string; serial?: SerialNumber; removedSerialId?: string; history?: { saleOrderId?: string; soldDate?: string; status: string } } | null
          if (!res.ok || !data?.serial) { store.showToast(data?.error || 'Could not record the serial', 'error'); return false }
          const ser = data.serial
          store.setSerials(p => {
            const rest = p.filter(s => s.id !== data.removedSerialId && s.id !== ser.id)
            return [...rest, ser]
          })
          const backBefore = data.history
            ? ` We had this machine before (${data.history.status}${data.history.soldDate ? `, ${String(data.history.soldDate).slice(0, 10)}` : ''}) — its history is kept.`
            : ''
          store.setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : {
            ...j,
            serialId: ser.id,
            serialNumber: ser.serial,
            productId: ser.productId,
            productName: ser.productName,
            ...(ser.specs ? { specs: ser.specs, specsAtIntake: ser.specs } : {}),
            identityPending: false,
            identifiedDate: now(),
            techNotes: (j.techNotes ? j.techNotes + '\n' : '') + `Identified: tag ${j.intakeTag || j.serialNumber} is ${ser.serial} (${ser.productName}).${backBefore}`,
          }))
          store.addAuditLog('refurb_identify', job.ref, `Tag ${job.intakeTag || job.serialNumber} identified as ${ser.serial} · ${ser.productName}`)
          store.showToast(`${job.intakeTag || job.serialNumber} is ${ser.serial}.${backBefore} Reprint the label.`)
          return true
        } catch {
          store.showToast('Could not record the serial. Check your connection and try again.', 'error')
          return false
        }
      },

    harvestRefurbishmentJob: async (jobId, reason, parts) => {
        const job = store.refurbishmentJobs.find(j => j.id === jobId)
        if (!job) return false
        let data: { error?: string; machineCost?: number; partsValue?: number; parts?: NonNullable<RefurbishmentJob['harvestedParts']>; valuationRef?: string } | null = null
        try {
          const res = await fetch('/api/refurbishment/harvest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serialId: job.serialId, reference: job.ref, reason, parts }),
          })
          data = await res.json().catch(() => null)
          if (!res.ok) { store.showToast(data?.error || 'Could not record the parts', 'error'); return false }
        } catch {
          store.showToast('Could not record the parts. Check your connection and try again.', 'error')
          return false
        }
        const machineCost = Number(data?.machineCost) || 0
        const partsValue = Number(data?.partsValue) || 0
        const kept = data?.parts ?? []
        // Parts taken from stock for it and never fitted go back, as on a write-off.
        const returned = job.partsNeeded.filter(p => p.productId && p.status !== 'used' && refurbPartStockTaken(p))
        for (const p of returned) store.returnRefurbPartToWarehouse(job, p)
        const returnedIds = new Set(returned.map(p => p.id))
        store.setSerials(p => p.map(s => s.id !== job.serialId ? s : { ...s, status: 'written_off' }))
        store.setRefurbishmentJobs(p => p.map(j => j.id !== jobId ? j : {
          ...j,
          status: 'written_off',
          outcome: 'harvested',
          harvestedParts: kept,
          harvestPartsValue: partsValue,
          writeOffCost: Math.max(0, Math.round((machineCost - partsValue) * 100) / 100),
          writeOffValuationRef: data?.valuationRef,
          completedDate: now(),
          techNotes: (j.techNotes ? j.techNotes + '\n' : '') + `Harvested for parts: ${reason}. Kept: ${kept.map(k => `${k.qty}× ${k.productName}`).join(', ')}`,
          partsNeeded: j.partsNeeded.map(pt => returnedIds.has(pt.id)
            ? { ...pt, status: 'needed' as const, stockTaken: false, allocatedDate: undefined, allocatedByName: undefined, notifiedTechDate: undefined, notes: [pt.notes, 'Returned to stock when harvested'].filter(Boolean).join(' · ') }
            : pt),
        }))
        store.addAuditLog('refurb_harvest', job.ref, `Harvested ${job.serialNumber}: ${kept.map(k => `${k.qty}× ${k.productName}`).join(', ')} (KES ${partsValue.toLocaleString('en-KE')} of KES ${machineCost.toLocaleString('en-KE')} kept in stock)`)
        store.showToast([
          `${job.serialNumber} stripped — ${kept.reduce((s, k) => s + k.qty, 0)} part(s) in stock`,
          machineCost ? `KES ${partsValue.toLocaleString('en-KE')} kept as parts, KES ${Math.max(0, machineCost - partsValue).toLocaleString('en-KE')} written off` : '',
        ].filter(Boolean).join(' — '))
        return true
      },

    // ── Stock Transfers ────────────────────────────────────────────────────────
    createTransfer: (from, to, notes = '') => {
        if (!canManageInventoryControl(store.currentUser())) { store.showToast('Only inventory-controlled roles can create transfers', 'error'); throw new Error('Unauthorized transfer creation') }
        const tr: StockTransfer = { id: uid(), ref: allocateDocNumberSync('TR'), fromLocation: from, toLocation: to, status: 'draft', date: now(), lines: [], notes }
        store.setStockTransfers(p => [tr, ...p]); store.numberTransfers([tr.id]); store.showToast('Transfer created'); return tr
      },

    addTransferLine: (transferId, productId, productName, qty, serialIds) => {
        store.setStockTransfers(p => p.map(t => t.id !== transferId ? t : { ...t, lines: [...t.lines, { productId, productName, qty, serialIds }] }))
      },

    validateTransfer: async (transferId) => {
        if (!canManageInventoryControl(store.currentUser())) { store.showToast('Only inventory-controlled roles can validate transfers', 'error'); return }
        let tr = store.stockTransfers.find(t => t.id === transferId)!
        const trRef = await store.ensureUniqueServerRef('transfer', 'TR', tr, store.stockTransfers, store.applyTransferNumber)
        if (!trRef) { store.showToast('Could not get a number for this transfer from the server — try again', 'error'); return }
        tr = { ...tr, ref: trRef }
        try {
          const res = await fetch('/api/inventory/apply-transfer-stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transferRef: tr.ref,
              fromLocation: tr.fromLocation,
              toLocation: tr.toLocation,
              lines: tr.lines.map(l => ({
                productId: l.productId,
                productName: l.productName,
                qty: l.qty,
                serialIds: l.serialIds,
              })),
            }),
          })
          if (!res.ok) {
            const payload = await res.json().catch(() => null) as { error?: string } | null
            store.showToast(payload?.error || 'Transfer validation failed', 'error')
            return
          }
        } catch {
          store.showToast('Could not apply transfer on server', 'error')
          return
        }
        // Mirror server stock into local UI (moves already persisted server-side).
        tr.lines.forEach(l => {
          if (l.serialIds.length > 0) {
            l.serialIds.forEach(sid => store.setSerials(p => p.map(s => s.id === sid ? { ...s, location: tr.toLocation } : s)))
          } else {
            store.setBulkStock(prev => store.upsertBulkStock(store.upsertBulkStock(prev, l.productId, tr.fromLocation, -l.qty), l.productId, tr.toLocation, l.qty))
          }
        })
        store.setStockTransfers(p => p.map(t => t.id === transferId ? { ...t, status: 'done' } : t))
        store.showToast(`Transfer ${tr.ref} validated — stock moved to ${store.LOCATIONS[tr.toLocation].name}`)
      },

    // ── Combined create+validate in one atomic step (avoids React batching race) ──
    submitTransfer: async (from, to, productId, productName, qty, serialIds, notes = '') => {
        if (!canManageInventoryControl(store.currentUser())) {
          store.showToast('Only inventory-controlled roles can create transfers', 'error')
          return false
        }
        if (from === to) {
          store.showToast('Source and destination must be different', 'error')
          return false
        }
        if (qty <= 0) {
          store.showToast('Transfer quantity must be greater than zero', 'error')
          return false
        }
        // Validate source has enough stock before moving
        const product = store.products.find(p => p.id === productId)
        if (product && !product.requiresSerial) {
          const srcQty = store.calcStockByLocation(product, store.serialRef.current, store.bulkStock, productId)[from] ?? 0
          if (srcQty < qty) {
            store.showToast(`Insufficient stock at ${store.LOCATIONS[from].name}: ${srcQty} available, ${qty} requested`, 'error')
            return false
          }
        }
        // Server number first; the stock moves carry it.
        const ref = await allocateDocNumber('transfer').catch(() => allocateDocNumberSync('TR'))
        const id = uid()
        const line = { productId, productName, qty, serialIds }
        try {
          const res = await fetch('/api/inventory/apply-transfer-stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transferRef: ref,
              fromLocation: from,
              toLocation: to,
              lines: [{ productId, productName, qty, serialIds }],
            }),
          })
          if (!res.ok) {
            const payload = await res.json().catch(() => null) as { error?: string } | null
            store.showToast(payload?.error || 'Transfer failed', 'error')
            return false
          }
        } catch {
          store.showToast('Could not apply transfer on server', 'error')
          return false
        }
        // Mirror server stock into local UI (moves already persisted server-side).
        if (serialIds.length > 0) {
          serialIds.forEach(sid => store.setSerials(p => p.map(s => s.id === sid ? { ...s, location: to } : s)))
        } else {
          store.setBulkStock(prev => store.upsertBulkStock(store.upsertBulkStock(prev, productId, from, -qty), productId, to, qty))
        }
        const tr: StockTransfer = { id, ref, fromLocation: from, toLocation: to, status: 'done', date: now(), lines: [line], notes }
        store.setStockTransfers(p => [tr, ...p])
        if (isProvisionalDocRef(ref)) store.numberTransfers([id])
        store.showToast(`Transfer ${isProvisionalDocRef(ref) ? '' : `${ref} `}validated — stock moved to ${store.LOCATIONS[to].name}`)
        return true
      },

    // ── Stock Adjustments ─────────────────────────────────────────────────────
    createAdjustment: (productId, productName, type, qty, reason, notes) => {
        if (!canManageInventoryControl(store.currentUser())) { store.showToast('Only inventory-controlled roles can request adjustments', 'error'); throw new Error('Unauthorized adjustment request') }
        const prod = store.prodRef.current.find(x => x.id === productId)
        const resolved = prod ? resolveProductAccounts(prod) : null
        const varianceAccountCode = resolved?.adjustmentAccountCode || resolved?.costAccountCode
        const writeOffAccountCode = resolved?.writeOffAccountCode || resolved?.adjustmentAccountCode || resolved?.costAccountCode
        if (prod && type === 'add' && !resolved?.inventoryAccountCode) {
          store.showToast(`${prod.name} is missing an Inventory Asset account`, 'error')
          throw new Error('Missing inventory asset account')
        }
        if (prod && type === 'subtract' && !writeOffAccountCode) {
          store.showToast(`${prod.name} is missing a write-off or adjustment account`, 'error')
          throw new Error('Missing stock variance account')
        }
        const adj: StockAdjustment = {
          // A stand-in number until the server's arrives a moment later (it
          // used to be counted per browser, so ADJ/0001 repeated).
          id: uid(), ref: allocateDocNumberSync('ADJ'), productId, productName, type, qty, reason, notes,
          inventoryAccountCode: resolved?.inventoryAccountCode,
          varianceAccountCode,
          writeOffAccountCode,
          status: 'pending', requestedBy: store.currentUser()?.name ?? 'Unknown', date: now(),
        }
        store.setStockAdjustments(p => [adj, ...p])
        store.numberAdjustments([adj.id])
        store.addAuditLog('create_adjustment', adj.ref, `Stock adjustment requested for ${productName}`)
        store.showToast('Adjustment submitted for approval')
        return adj
      },

    approveAdjustment: async (adjId, approved) => {
        if (!canApproveInventoryAction(store.currentUser())) { store.showToast('Only inventory approvers can approve adjustments', 'error'); return }
        let adj = store.adjRef.current.find(a => a.id === adjId)
        if (!adj) return
        // Its stock value and journal are posted under its number, and the
        // valuation skips a number it has seen for this product: so it needs its
        // own server number first (not a stand-in, not one another adjustment has).
        if (approved) {
          const ref = await store.ensureUniqueServerRef('adjustment', 'ADJ', adj, store.adjRef.current, store.applyAdjustmentNumber)
          if (!ref) { store.showToast('Could not get a number for this adjustment from the server — try again', 'error'); return }
          adj = { ...adj, ref }
        }
        if (approved) {
          const prod = store.prodRef.current.find(x => x.id === adj.productId)
          if (prod) {
            try {
              const res = await fetch('/api/inventory/apply-adjustment-stock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  adjustmentRef: adj.ref,
                  productId: adj.productId,
                  productName: adj.productName,
                  type: adj.type,
                  qty: adj.qty,
                  reason: adj.reason,
                  location: 'warehouse',
                  unitCost: prod.costPrice || 0,
                }),
              })
              if (!res.ok) {
                const payload = await res.json().catch(() => null) as { error?: string } | null
                store.showToast(payload?.error || 'Adjustment stock update failed', 'error')
                return
              }
            } catch {
              store.showToast('Could not apply adjustment on server', 'error')
              return
            }
            // Server applies blob stock + Prisma valuation/STK journal. Do not
            // re-mutate local qty or post a second blob journal at list cost.
            store.addAuditLog('post_stock_adjustment', adj.ref, `Stock adjustment applied on server`)
          }
        }
        store.setStockAdjustments(p => p.map(a => a.id === adjId ? { ...a, status: approved ? 'approved' : 'rejected', approvedBy: store.currentUser()?.name, approvedDate: now() } : a))
        store.addAuditLog('adjustment_decision', adj.ref, `Adjustment ${approved ? 'approved' : 'rejected'} for ${adj.productName}`)
        store.showToast(`Adjustment ${approved ? 'approved · stock updated' : 'rejected'}`)
      },

    // ── Reports ───────────────────────────────────────────────────────────────
    getStockByLocation: (productId) => {
        const prod = store.prodRef.current.find(x => x.id === productId)
        return store.calcStockByLocation(prod, store.serialRef.current, store.bulkStock, productId, true)
      },

    getMonthlyMovements: (productId) => {
        const moves = store.stockMoves.filter(m => m.productId === productId)
        const opening = 0
        const purchases = moves.filter(m => m.type === 'in').reduce((a, m) => a + m.qty, 0)
        const sales = moves.filter(m => m.type === 'out').reduce((a, m) => a + m.qty, 0)
        const usage = moves.filter(m => m.type === 'transfer').reduce((a, m) => a + m.qty, 0)
        return { opening, purchases, sales, usage, closing: opening + purchases - sales - usage }
      },

    // ── Stock Reservations ────────────────────────────────────────────────────
    reserveStock: (productId, qty, reservedFor, referenceId, referenceRef) => {
        const product = store.products.find(p => p.id === productId)
        if (!product) return null
        
        const reservation = {
          id: uid(),
          productId,
          productName: product.name,
          qty,
          reservedFor,
          referenceId,
          referenceRef,
          location: 'warehouse',
          reservedBy: store.currentUser()?.name ?? 'System',
          reservedDate: now(),
          expiresDate: store.addDays(now(), 7),
          status: 'reserved',
          fulfilledQty: 0,
          serialNumbers: [],
        }
        
        store.setStockReservations(prev => [...prev, reservation])
        store.addAuditLog('reserve_stock', referenceRef, `Reserved ${qty} × ${product.name}`)
        
        return reservation
      },

    getReservedQty: (productId) => {
        return store.stockReservations
          .filter(r => r.productId === productId && r.status === 'reserved')
          .reduce((sum, r) => sum + r.qty, 0)
      },

    getAvailableStock: (productId) => {
        const product = store.products.find(p => p.id === productId)
        if (!product) return 0
        
        const reservedQty = store.stockReservations
          .filter(r => r.productId === productId && r.status === 'reserved')
          .reduce((sum, r) => sum + r.qty, 0)
        
        return product.stockQty - reservedQty
      },

    fulfillReservation: (productId, referenceId, qty) => {
        const reservation = store.stockReservations.find(r =>
          r.productId === productId &&
          r.referenceId === referenceId &&
          r.status === 'reserved'
        )
        
        if (!reservation) return
        
        const newFulfilledQty = reservation.fulfilledQty + qty
        
        store.setStockReservations(prev => prev.map(r => {
          if (r.id !== reservation.id) return r
          
          return {
            ...r,
            fulfilledQty: newFulfilledQty,
            status: newFulfilledQty >= r.qty ? 'fulfilled' : 'reserved',
            fulfilledDate: newFulfilledQty >= r.qty ? now() : undefined,
          }
        }))
      },

    cancelReservation: (referenceId, reason) => {
        store.setStockReservations(prev => prev.map(r =>
          r.referenceId === referenceId
            ? { ...r, status: 'cancelled', notes: reason }
            : r
        ))
        
        store.addAuditLog('cancel_reservation', referenceId, `Cancelled: ${reason}`)
      },
  }
}
