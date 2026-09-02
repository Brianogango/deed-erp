from pathlib import Path

store = Path('lib/store.tsx')
s = store.read_text()

old_sig = "generateRepairQuote: (repairId: string, lines: Omit<RepairQuoteLine, 'id' | 'reserved'>[], applyVat?: boolean) => void"
new_sig = "generateRepairQuote: (repairId: string, lines: Omit<RepairQuoteLine, 'id' | 'reserved'>[], applyVat?: boolean) => Promise<RepairQuote | undefined>"
if old_sig not in s:
    raise SystemExit('generateRepairQuote signature not found')
s = s.replace(old_sig, new_sig, 1)

scope = s.index("        const portalMsg = reopeningAfterDecline")
notify_start = s.index("        if (repair.customerEmail || repair.customerPhone) {", scope)
toast_end_marker = "        )\n      }\n    },\n    \n    sendQuoteToCustomer: async (repairId) => {"
toast_end = s.index(toast_end_marker, notify_start)
new_chunk = """        let customerNotified = false
        if (repair.customerEmail || repair.customerPhone) {
          const trackingUrl = typeof window !== 'undefined'
            ? `${window.location.origin}/portal/repair/${encodeURIComponent(repair.ref)}`
            : undefined
          try {
            const notifyResponse = await fetch('/api/notifications/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'quote',
                repairRef: repair.ref,
                quoteTotal: quote.total,
                quoteUrl: trackingUrl,
                changeSummary,
                isRevision: isUpdate,
                idempotencyKey: `repair-quote:${repair.id}:${quote.id}`,
                channels: ['email', 'whatsapp', 'sms'],
              }),
            })
            const notifyResult = await notifyResponse.json().catch(() => null)
            customerNotified = Boolean(notifyResponse.ok && notifyResult?.success)
          } catch {
            customerNotified = false
          }
        }
        showToast(
          customerNotified
            ? reopeningAfterDecline
              ? 'Revised quote sent after decline — customer re-notified for approval'
              : isUpdate
                ? 'Quote updated — customer re-notified for approval'
                : 'Quote generated — customer notified for approval'
            : (repair.customerEmail || repair.customerPhone)
              ? (isUpdate ? 'Quote updated, but customer notification could not be confirmed' : 'Quote generated, but customer notification could not be confirmed')
              : (isUpdate ? 'Quote updated — no customer email or phone is available' : 'Quote generated — no customer email or phone is available'),
          customerNotified ? 'success' : 'info',
        )"""
s = s[:notify_start] + new_chunk + s[toast_end + len("        )"):]

end_marker = "      }\n    },\n    \n    sendQuoteToCustomer: async (repairId) => {"
if end_marker not in s:
    raise SystemExit('generateRepairQuote end not found')
s = s.replace(end_marker, "      }\n      return quote\n    },\n    \n    sendQuoteToCustomer: async (repairId) => {", 1)
store.write_text(s)

modal = Path('components/modules/RepairModals.tsx')
m = modal.read_text()
call = "      await Promise.resolve(generateRepairQuote(repair.id, lines as any, applyVat))"
start = m.index(call)
end = m.index("      onClose()", start) + len("      onClose()")
m = m[:start] + """      const savedQuote = await Promise.resolve(generateRepairQuote(repair.id, lines as any, applyVat))
      // Quote generation owns portal sync and customer delivery. Keeping the
      // send in one place prevents duplicate messages and makes revisions reliable.
      if (!savedQuote) return
      onClose()""" + m[end:]
modal.write_text(m)

route = Path('app/api/notifications/send/route.ts')
r = route.read_text()
old = """      const title = type === 'quote'
        ? `Repair quotation ready — ${record.repair.jobNumber}`
        : `Repair update — ${record.repair.jobNumber}`
      const message = type === 'quote'
        ? `Your repair quotation is ready. Repair: ${record.repair.jobNumber}. Device: ${deviceName}. Total: KES ${quoteTotal.toLocaleString('en-KE')}.${params.quoteUrl ? ` View: ${params.quoteUrl}` : ''}`
        : String(params.message || 'There is an update on your repair.')"""
new = """      const quoteRevision = type === 'quote' && Boolean(params.isRevision)
      const title = type === 'quote'
        ? `${quoteRevision ? 'Updated repair quotation' : 'Repair quotation ready'} — ${record.repair.jobNumber}`
        : `Repair update — ${record.repair.jobNumber}`
      const message = type === 'quote'
        ? `${quoteRevision ? 'Your repair quotation has been updated. Please review and approve the revised quote.' : 'Your repair quotation is ready.'} Repair: ${record.repair.jobNumber}. Device: ${deviceName}. Total: KES ${quoteTotal.toLocaleString('en-KE')}.${params.quoteUrl ? ` View: ${params.quoteUrl}` : ''}`
        : String(params.message || 'There is an update on your repair.')"""
if old not in r:
    raise SystemExit('notification message block not found')
route.write_text(r.replace(old, new, 1))

Path('.github/workflows/apply-repair-requote-fix.yml').unlink(missing_ok=True)
Path('.github/workflows/inspect-repair-requote.yml').unlink(missing_ok=True)
Path('scripts/apply-repair-requote-fix.py').unlink()
