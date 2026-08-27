import { describe, expect, it } from 'vitest'
import {
  buildLaptopSalesDescription,
  isDetailedLaptopDescription,
  planLaptopDescriptionUpdate,
  shouldSkipLaptopCatalogRow,
} from '@/lib/inventory/laptop-description'

describe('isDetailedLaptopDescription', () => {
  it('keeps OmniBook-style retail copy', () => {
    expect(isDetailedLaptopDescription(
      'HP OmniBook X Flip 2-in-1 14-fm0023dx with Intel Core Ultra 7 256V up to 4.8GHz, 16GB LPDDR5x-8533 onboard RAM, 1TB PCIe Gen4 NVMe M.2 SSD, 14-inch 2K multi-touch display (1920 x 1200), 400 nits, Intel AI Boost, integrated Intel Arc 140V GPU (8GB), 1 Thunderbolt 4 USB-C 40Gbps port, HDMI 2.1, Atmospheric Blue finish, and 1-year warranty.',
    )).toBe(true)
  })

  it('treats CPU/RAM/SSD-only and configured-with templates as thin', () => {
    expect(isDetailedLaptopDescription('10th Gen Intel Core i5, 8GB RAM, 256GB SSD')).toBe(false)
    expect(isDetailedLaptopDescription(
      'HP EliteBook 830 G7 configured with 10th Gen Intel Core i5, 8GB RAM, 256GB SSD.',
    )).toBe(false)
  })
})

describe('buildLaptopSalesDescription', () => {
  it('does not treat 250GB SSD as an HP 250 screen size', () => {
    const text = buildLaptopSalesDescription(
      'Apple MacBook Air 2015 - Intel Core i5, 8GB RAM, 250GB SSD',
    )
    expect(text).toMatch(/13\.3-inch/)
    expect(text).not.toMatch(/15\.6/)
  })

  it('adds 13.3" non-touch clamshell and UHD on a thin EliteBook 830 G7', () => {
    const text = buildLaptopSalesDescription(
      'HP EliteBook 830 G7 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD - 13"',
    )
    expect(text).toContain('10th Gen Intel Core i5')
    expect(text).toContain('8GB RAM')
    expect(text).toContain('256GB SSD')
    expect(text).toMatch(/13(\.3)?-inch/)
    expect(text).toMatch(/non-touch/)
    expect(text).toMatch(/clamshell/)
    expect(text).toMatch(/UHD Graphics/i)
  })

  it('marks EliteBook 830 G8 x360 as multi-touch convertible with Iris Xe', () => {
    const text = buildLaptopSalesDescription(
      'HP EliteBook 830 G8 x360 - 11th Gen Intel Core i5, 8GB RAM, 256GB SSD',
    )
    expect(text).toMatch(/multi-touch/)
    expect(text).toMatch(/x360 convertible/)
    expect(text).toMatch(/Iris Xe/i)
  })

  it('keeps a named NVIDIA GPU', () => {
    const text = buildLaptopSalesDescription(
      'HP ProBook 470 G4 - 7th Gen Intel Core i5, 8GB RAM, 256GB SSD, 2GB NVIDIA GeForce 930MX Graphics',
    )
    expect(text).toMatch(/NVIDIA GeForce 930MX/i)
    expect(text).toMatch(/17\.3-inch/)
  })

  it('uses 5th-gen HD graphics on a ZBook G2 title', () => {
    const text = buildLaptopSalesDescription('Hp Zbook 14 G2 i7 5th 8GB RAM 512GB SSD')
    expect(text).toContain('512GB SSD')
    expect(text).toMatch(/HD Graphics/)
    expect(text).not.toMatch(/UHD/)
  })

  it('does not treat Omen model 16 as 16GB of SSD', () => {
    const text = buildLaptopSalesDescription(
      'HP Omen 16 - Gaming Laptop 16 - am0073dx - Core Ulra 7 - 16GB RAM - 1TB SSD - NVIDIA RTX 5080 8GB',
    )
    expect(text).toContain('16GB RAM')
    expect(text).toContain('1TB SSD')
    expect(text).toMatch(/RTX 5080/i)
  })

  it('skips batteries and all-in-ones', () => {
    expect(shouldSkipLaptopCatalogRow('Battery Lenovo Thinkpad T490s/T495s/18m3pd1 Original')).toBe(true)
    expect(shouldSkipLaptopCatalogRow('Apple iMac 21.5-inch Late 2017 - Intel Core i5, 8GB RAM, 256GB SSD')).toBe(true)
    expect(planLaptopDescriptionUpdate({
      name: 'Battery Lenovo Thinkpad T490s/T495s/18m3pd1 Original',
      description: '',
    }).action).toBe('skip-not-laptop')
  })

  it('does not overwrite an already detailed description', () => {
    const detailed = 'Intel Core Ultra 7 256V up to 4.8GHz, 16GB LPDDR5x-8533 onboard RAM, 1TB PCIe Gen4 NVMe M.2 SSD, 14-inch 2K multi-touch display (1920 x 1200), 400 nits, Intel Arc 140V GPU (8GB), Thunderbolt 4, HDMI 2.1, 1-year warranty.'
    expect(planLaptopDescriptionUpdate({
      name: 'HP OmniBook X Flip 2-in-1 14-fm0023dx',
      description: detailed,
    }).action).toBe('skip-detailed')
  })
})
