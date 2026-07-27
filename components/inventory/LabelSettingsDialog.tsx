'use client'

import { Field, Input, Modal, Select } from '@/components/ui'
import {
  DEFAULT_LABEL_SETTINGS,
  LABEL_SIZE_OPTIONS,
  LABEL_TEMPLATE_OPTIONS,
  type LabelSettings,
  normalizeLabelSettings,
} from '@/lib/inventory/label-settings'

interface LabelSettingsDialogProps {
  open: boolean
  value: LabelSettings
  onChange: (next: LabelSettings) => void
  onClose: () => void
  onApply: (next: LabelSettings) => void
}

export default function LabelSettingsDialog({
  open,
  value,
  onChange,
  onClose,
  onApply,
}: LabelSettingsDialogProps) {
  if (!open) return null
  const settings = normalizeLabelSettings(value)

  const set = <K extends keyof LabelSettings>(key: K, next: LabelSettings[K]) => {
    onChange({ ...settings, [key]: next })
  }

  return (
    <Modal title="Label settings" onClose={onClose} width={520}>
      <div className="space-y-3">
        <Field label="Template">
          <Select
            value={settings.template}
            onChange={v => set('template', v as LabelSettings['template'])}
            options={LABEL_TEMPLATE_OPTIONS.map(o => ({ value: o.id, label: o.label }))}
          />
        </Field>
        <Field label="Label size">
          <Select
            value={settings.size}
            onChange={v => set('size', v as LabelSettings['size'])}
            options={LABEL_SIZE_OPTIONS.map(o => ({ value: o.id, label: o.label }))}
          />
        </Field>
        <Field label="Copies per record">
          <Input
            type="number"
            value={String(settings.copies)}
            onChange={v => set('copies', Math.max(1, Math.min(50, Number(v) || 1)))}
          />
        </Field>
        <Field label="Print order">
          <Select
            value={settings.printOrder}
            onChange={v => set('printOrder', v as LabelSettings['printOrder'])}
            options={[
              { value: 'selection', label: 'Selection order' },
              { value: 'name', label: 'Product name' },
              { value: 'sku', label: 'SKU' },
            ]}
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-[var(--text-2)]">
          {([
            ['includeCompanyName', 'Company name'],
            ['includeProductName', 'Product name'],
            ['includeSku', 'SKU'],
            ['includeSerial', 'Serial number'],
            ['includeBarcode', 'Barcode'],
            ['includeQr', 'QR code'],
            ['includePrice', 'Sale price'],
          ] as const).map(([key, label]) => (
            <label key={key} className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={e => set(key, e.target.checked)}
              />
              {label}
            </label>
          ))}
        </div>
        <div className="flex justify-between gap-2 pt-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onChange(DEFAULT_LABEL_SETTINGS)}
          >
            Reset defaults
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => onApply(normalizeLabelSettings(settings))}
            >
              Apply settings
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
