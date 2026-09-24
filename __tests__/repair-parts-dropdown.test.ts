import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

/**
 * REGRESSION 24-Sep-2026 — the parts picker inside Update Quote landed off
 * the field: with a full list (8 rows ≈ 540px) it was placed against the
 * input's top edge and ran past the top of the window, or hung below the
 * dialog. It was also painted UNDER the dialog: components/erp/
 * overlay-stacking.css puts modals on 9850 with !important, so the panel's
 * 9700/9800 lost. Verified in Chromium against the real component.
 */
const source = fs.readFileSync('components/modules/RepairModals.tsx', 'utf8')
const stackingContract = fs.readFileSync('components/erp/overlay-stacking.css', 'utf8')

describe('repair parts picker dropdown', () => {
  it('sits above the dialog layer that overlay-stacking.css enforces', () => {
    const dialogLayer = Number(/z-index:\s*(\d+)\s*!important/.exec(stackingContract)?.[1])
    expect(dialogLayer).toBe(9850)
    const panelLayers = [...source.matchAll(/className="fixed z-\[(\d+)\]/g)].map(m => Number(m[1]))
    expect(panelLayers.length).toBeGreaterThan(0)
    for (const layer of panelLayers) expect(layer).toBeGreaterThan(dialogLayer)
  })

  it('bounds the panel to the space available instead of a fixed guess', () => {
    expect(source).toMatch(/maxHeight: Math\.min\(MAX_PANEL, room\)/)
    expect(source).toMatch(/const spaceBelow = window\.innerHeight - rect\.bottom/)
    expect(source).toMatch(/const spaceAbove = rect\.top/)
    // and the panel scrolls rather than overflowing the viewport
    expect(source).toMatch(/overflowY: 'auto'/)
  })

  it('keeps following its input while open', () => {
    expect(source).toMatch(/requestAnimationFrame\(track\)/)
  })
})
