'use client'

import { useState } from 'react'
import { Modal, Field, Textarea, Badge } from '@/components/ui'
import type { RepairOrder, RepairStatus } from '@/lib/store'

interface ProgressUpdateProps {
  repair: RepairOrder
  currentStatus: RepairStatus
  onUpdate: (newStatus: RepairStatus, message: string, notifyCustomer: boolean) => void
  onClose: () => void
}

const STATUS_LABELS: Record<RepairStatus, string> = {
  received: 'Received',
  assigned: 'Assigned',
  diagnosed: 'Diagnosed',
  awaiting_approval: 'Awaiting Approval',
  approved: 'Approved',
  awaiting_parts: 'Awaiting Parts',
  in_repair: 'In Repair',
  qc: 'QC Testing',
  ready: 'Ready for Pickup',
  invoiced: 'Invoiced',
  delivered: 'Delivered',
  closed: 'Closed',
  declined: 'Quote Declined',
  unrepairable: 'Unrepairable',
  returned: 'Returned to Customer',
  cancelled: 'Cancelled',
}

const STATUS_FLOW: Record<RepairStatus, RepairStatus[]> = {
  received: ['assigned', 'unrepairable', 'cancelled'],
  assigned: ['diagnosed', 'unrepairable', 'cancelled'],
  diagnosed: ['awaiting_approval', 'unrepairable', 'cancelled'],
  awaiting_approval: ['approved', 'declined', 'cancelled'],
  approved: ['awaiting_parts', 'in_repair', 'cancelled'],
  awaiting_parts: ['in_repair', 'cancelled'],
  in_repair: ['qc', 'awaiting_parts', 'unrepairable', 'cancelled'],
  qc: ['ready', 'in_repair', 'cancelled'],
  ready: ['invoiced', 'delivered'],
  invoiced: ['delivered'],
  delivered: ['closed'],
  declined: ['returned'],
  unrepairable: ['returned'],
  returned: ['closed'],
  closed: [],
  cancelled: [],
}

const CUSTOMER_TEMPLATES: Record<RepairStatus, string> = {
  received: 'We have received your device and created a repair ticket.',
  assigned: 'Your repair has been assigned to a technician.',
  diagnosed: 'Diagnosis complete. We will send you a quote shortly.',
  awaiting_approval: 'We have sent you a quote for the repair. Please review and approve.',
  approved: 'Quote approved! We are proceeding with the repair.',
  awaiting_parts: 'We are waiting for required parts to arrive. We will keep you updated.',
  in_repair: 'Your device is currently being repaired by our technician.',
  qc: 'Repair complete! We are running quality control tests.',
  ready: '🎉 Good news! Your device is ready for pickup at our service center.',
  invoiced: 'Your repair is complete and invoiced. Please collect your device.',
  delivered: 'Thank you! Your device has been delivered.',
  closed: 'Repair job completed. Thank you for choosing our service!',
  declined: 'We understand you declined the repair. Your device is ready for pickup.',
  unrepairable: 'Unfortunately, your device cannot be repaired. It is ready for return pickup.',
  returned: 'Your device has been returned. Thank you.',
  cancelled: 'Your repair has been cancelled.',
}

export default function ProgressUpdate({ repair, currentStatus, onUpdate, onClose }: ProgressUpdateProps) {
  const [selectedStatus, setSelectedStatus] = useState<RepairStatus | null>(null)
  const [message, setMessage] = useState('')
  const [notifyCustomer, setNotifyCustomer] = useState(true)
  const [customMessage, setCustomMessage] = useState(false)
  const [internalNotes, setInternalNotes] = useState('')

  const nextStatuses = STATUS_FLOW[currentStatus] || []

  const handleUpdate = () => {
    if (!selectedStatus) {
      alert('Please select a status')
      return
    }

    const finalMessage = customMessage ? message : CUSTOMER_TEMPLATES[selectedStatus]
    onUpdate(selectedStatus, finalMessage, notifyCustomer)
    onClose()
  }

  const handleStatusSelect = (status: RepairStatus) => {
    setSelectedStatus(status)
    setMessage(CUSTOMER_TEMPLATES[status])
    setCustomMessage(false)
  }

  if (nextStatuses.length === 0) {
    return (
      <Modal title="Progress Update" onClose={onClose} width={600}>
        <div className="text-center py-8">
          <div className="text-5xl mb-4">✓</div>
          <p className="text-white mb-2">Repair Complete</p>
          <p className="text-sm text-[#98a2b3]">
            This repair is in its final status: <strong>{STATUS_LABELS[currentStatus]}</strong>
          </p>
        </div>
        <div className="flex justify-end mt-6">
          <button onClick={onClose} className="btn btn-secondary">
            Close
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Update Repair Progress" onClose={onClose} width={700}>
      {/* Repair Info */}
      <div className="bg-[#0c0e14] border border-white/10 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-white font-semibold">{repair.ref}</div>
            <div className="text-sm text-[#98a2b3]">{repair.productName}</div>
          </div>
          <Badge status={currentStatus} label={STATUS_LABELS[currentStatus]} />
        </div>
        <div className="text-sm text-[#98a2b3]">
          Customer: {repair.customerName} · {repair.customerPhone}
        </div>
      </div>

      {/* Status Selection */}
      <div className="mb-6">
        <label className="block text-sm font-semibold text-white mb-3">
          Select Next Status
        </label>
        <div className="grid grid-cols-2 gap-3">
          {nextStatuses.map(status => (
            <button
              key={status}
              onClick={() => handleStatusSelect(status)}
              className={`p-4 rounded-lg border-2 transition-all text-left ${
                selectedStatus === status
                  ? 'border-[#875BF7] bg-[#875BF7]/10'
                  : 'border-white/10 bg-[#0c0e14] hover:border-white/20'
              }`}
            >
              <div className="font-semibold text-white mb-1">
                {STATUS_LABELS[status]}
              </div>
              <div className="text-xs text-[#98a2b3]">
                {status === 'cancelled' ? 'Cancel this repair' : 'Move to next stage'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Customer Notification */}
      {selectedStatus && (
        <>
          <div className="mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyCustomer}
                onChange={e => setNotifyCustomer(e.target.checked)}
                className="w-4 h-4 rounded accent-[#875BF7]"
              />
              <span className="text-sm text-white font-medium">
                Notify customer via SMS/WhatsApp
              </span>
            </label>
          </div>

          {notifyCustomer && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-semibold text-white">
                  Customer Message
                </label>
                <button
                  onClick={() => setCustomMessage(!customMessage)}
                  className="text-xs text-[#875BF7] hover:underline"
                >
                  {customMessage ? 'Use Template' : 'Customize Message'}
                </button>
              </div>

              {customMessage ? (
                <Textarea
                  value={message}
                  onChange={v => setMessage(v)}
                  rows={4}
                  placeholder="Type your custom message..."
                />
              ) : (
                <div className="bg-[#0c0e14] border border-white/10 rounded-lg p-4">
                  <div className="text-xs text-[#98a2b3] mb-2">Preview:</div>
                  <div className="text-sm text-white">
                    Hi {repair.customerName},<br />
                    <br />
                    {message}
                    <br />
                    <br />
                    Repair: {repair.ref}<br />
                    Device: {repair.productName}
                    <br />
                    <br />
                    - Deed Technologies
                  </div>
                </div>
              )}

              <div className="mt-2 text-xs text-[#98a2b3]">
                💡 Customer will receive this update at: {repair.customerPhone}
              </div>
            </div>
          )}
        </>
      )}

      {/* Progress Notes */}
      <div className="mb-6">
        <label className="block text-sm font-semibold text-white mb-2">
          Internal Notes (optional)
        </label>
        <Textarea
          value={internalNotes}
          onChange={v => setInternalNotes(v)}
          placeholder="Add any internal notes about this progress update..."
          rows={2}
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <button onClick={onClose} className="btn btn-secondary">
          Cancel
        </button>
        <button
          onClick={handleUpdate}
          disabled={!selectedStatus}
          className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {notifyCustomer ? 'Update & Notify Customer' : 'Update Status'}
        </button>
      </div>
    </Modal>
  )
}
