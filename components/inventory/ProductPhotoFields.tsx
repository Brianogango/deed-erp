'use client'

import React, { useRef, useState } from 'react'
import { Fa } from '@/components/icons'
import { faImage, faTrash, faUpload } from '@fortawesome/free-solid-svg-icons'
import { readGuardedImageAsDataUrl, ImageGuardError } from '@/lib/client-image-guard'
import type { ProductImageSlot } from '@/lib/product-images'

type SlotState = {
  url: string | null
  source: 'upload' | 'catalog' | null
  pending?: boolean
}

const SLOTS: Array<{ slot: ProductImageSlot; label: string; hint: string }> = [
  { slot: 1, label: 'Hero', hint: '3/4 front, product fills the frame' },
  { slot: 2, label: 'Detail', hint: 'Keyboard, ports, or label' },
]

export async function uploadProductPhoto(productId: string, slot: ProductImageSlot, dataUrl: string) {
  const res = await fetch(`/api/products/${productId}/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot, dataUrl }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Could not save photo')
  return String(body.image?.url || '')
}

export default function ProductPhotoFields({
  productId,
  slots,
  onSlotsChange,
  onToast,
}: {
  productId: string | null
  slots: Record<ProductImageSlot, SlotState>
  onSlotsChange: (next: Record<ProductImageSlot, SlotState>) => void
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void
}) {
  const [busySlot, setBusySlot] = useState<ProductImageSlot | null>(null)
  const inputRefs = {
    1: useRef<HTMLInputElement>(null),
    2: useRef<HTMLInputElement>(null),
  }

  const pickFile = async (slot: ProductImageSlot, file: File | null) => {
    if (!file) return
    setBusySlot(slot)
    try {
      const dataUrl = await readGuardedImageAsDataUrl(file, {
        label: slot === 1 ? 'Hero photo' : 'Detail photo',
        maxBytes: 8 * 1024 * 1024,
      })
      if (productId) {
        const url = await uploadProductPhoto(productId, slot, dataUrl)
        onSlotsChange({ ...slots, [slot]: { url, source: 'upload' } })
        onToast(slot === 1 ? 'Hero photo saved' : 'Detail photo saved', 'success')
      } else {
        onSlotsChange({ ...slots, [slot]: { url: dataUrl, source: 'upload', pending: true } })
      }
    } catch (err) {
      const message = err instanceof ImageGuardError || err instanceof Error
        ? err.message
        : 'Please upload a clean JPG, PNG, or WebP'
      onToast(message, 'error')
    } finally {
      setBusySlot(null)
      if (inputRefs[slot].current) inputRefs[slot].current.value = ''
    }
  }

  const remove = async (slot: ProductImageSlot) => {
    setBusySlot(slot)
    try {
      if (productId && slots[slot].source === 'upload' && !slots[slot].pending) {
        const res = await fetch(`/api/products/${productId}/images?slot=${slot}`, { method: 'DELETE' })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || 'Could not remove photo')
        }
      }
      onSlotsChange({ ...slots, [slot]: { url: null, source: null } })
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not remove photo', 'error')
    } finally {
      setBusySlot(null)
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider font-bold text-text-3 m-0">Product photos</p>
          <p className="text-[11px] text-text-3 m-0 mt-1 leading-relaxed">
            Two shots: hero and detail. JPEG/PNG/WebP, no watermark or logo overlay.
            Saved photos are resized to 1600px and sent to partner shops.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {SLOTS.map(({ slot, label, hint }) => {
          const current = slots[slot]
          const busy = busySlot === slot
          return (
            <div key={slot} className="rounded-lg border border-[var(--border)] overflow-hidden">
              <div className="aspect-[4/3] bg-[var(--info-bg)] flex items-center justify-center relative">
                {current.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={current.url} alt="" className="absolute inset-0 w-full h-full object-contain bg-white" />
                ) : (
                  <span className="text-text-4" aria-hidden="true"><Fa icon={faImage} /></span>
                )}
                {busy && (
                  <div className="absolute inset-0 bg-white/70 flex items-center justify-center text-[11px] font-semibold text-[var(--navy)]">
                    Saving…
                  </div>
                )}
              </div>
              <div className="px-3 py-2.5 flex items-start justify-between gap-2">
                <div>
                  <p className="text-[12px] font-semibold text-text-1 m-0">{label}</p>
                  <p className="text-[10px] text-text-3 m-0 mt-0.5">{hint}</p>
                  {current.source === 'catalog' && (
                    <p className="text-[10px] text-[var(--navy)] m-0 mt-1">Catalog fallback — replace with your photo</p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  <input
                    ref={inputRefs[slot]}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={e => { void pickFile(slot, e.target.files?.[0] ?? null) }}
                  />
                  <button
                    type="button"
                    className="btn-secondary text-[10px] px-2.5 py-1.5"
                    disabled={busy}
                    onClick={() => inputRefs[slot].current?.click()}
                  >
                    <Fa icon={faUpload} /> {current.url ? 'Replace' : 'Upload'}
                  </button>
                  {current.url && current.source === 'upload' && (
                    <button
                      type="button"
                      className="text-[10px] px-2.5 py-1.5 rounded-lg border border-red-100 bg-red-50 text-red-600 font-semibold"
                      disabled={busy}
                      onClick={() => { void remove(slot) }}
                    >
                      <Fa icon={faTrash} /> Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
