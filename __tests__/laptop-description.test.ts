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

  it('treats CPU/RAM/SSD-only, configured-with, and guessed FHD templates as thin', () => {
    expect(isDetailedLaptopDescription('10th Gen Intel Core i5, 8GB RAM, 256GB SSD')).toBe(false)
    expect(isDetailedLaptopDescription(
      'HP EliteBook 830 G7 configured with 10th Gen Intel Core i5, 8GB RAM, 256GB SSD.',
    )).toBe(false)
    expect(isDetailedLaptopDescription(
      '10th Gen Intel Core i5, 8GB RAM, 256GB SSD, 13.3-inch FHD (1920 x 1080) non-touch clamshell display, Intel UHD Graphics.',
    )).toBe(false)
  })
})

describe('buildLaptopSalesDescription', () => {
  it('does not treat 250GB SSD as an HP 250 screen size', () => {
    const text = buildLaptopSalesDescription(
      'Apple MacBook Air 2015 - Intel Core i5, 8GB RAM, 250GB SSD',
    )
    expect(text).toMatch(/13\.3-inch/)
    expect(text).toMatch(/1440 x 900/)
    expect(text).toMatch(/HD Graphics 6000/)
    expect(text).toMatch(/Thunderbolt 2/)
    expect(text).not.toMatch(/15\.6/)
  })

  it('uses EliteBook 830 G7 QuickSpecs for screen, GPU, and ports', () => {
    const text = buildLaptopSalesDescription(
      'HP EliteBook 830 G7 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD - 13"',
    )
    expect(text).toContain('10th Gen Intel Core i5')
    expect(text).toContain('8GB RAM')
    expect(text).toContain('256GB SSD')
    expect(text).toMatch(/13\.3-inch/)
    expect(text).toMatch(/FHD \(1920 x 1080\)/)
    expect(text).toMatch(/UHD Premium Graphics/i)
    expect(text).toMatch(/Thunderbolt 3/)
    expect(text).toMatch(/HDMI 1\.4/)
    expect(text).not.toMatch(/non-touch/)
    expect(text).not.toMatch(/clamshell/)
  })

  it('marks EliteBook x360 830 G8 as multi-touch convertible with Iris Xe and Thunderbolt 4', () => {
    const text = buildLaptopSalesDescription(
      'HP EliteBook 830 G8 x360 - 11th Gen Intel Core i5, 8GB RAM, 256GB SSD',
    )
    expect(text).toMatch(/multi-touch/)
    expect(text).toMatch(/x360 convertible/)
    expect(text).toMatch(/Iris Xe/i)
    expect(text).toMatch(/Thunderbolt 4/)
  })

  it('keeps a named NVIDIA GPU and 17.3-inch ProBook 470 G4 chassis', () => {
    const text = buildLaptopSalesDescription(
      'HP ProBook 470 G4 - 7th Gen Intel Core i5, 8GB RAM, 256GB SSD, 2GB NVIDIA GeForce 930MX Graphics',
    )
    expect(text).toMatch(/NVIDIA GeForce 930MX/i)
    expect(text).toMatch(/17\.3-inch/)
  })

  it('does not invent UHD graphics on a ZBook 14 G2', () => {
    const text = buildLaptopSalesDescription('Hp Zbook 14 G2 i7 5th 8GB RAM 512GB SSD')
    expect(text).toContain('512GB SSD')
    expect(text).toMatch(/14-inch/)
    expect(text).not.toMatch(/UHD/)
  })

  it('uses the official OMEN 16-am0073dx datasheet GPU, not the catalog RTX 5080 typo', () => {
    const text = buildLaptopSalesDescription(
      'HP Omen 16 - Gaming Laptop 16 - am0073dx - Core Ulra 7 - 16GB RAM - 1TB SSD - NVIDIA RTX 5080 8GB',
    )
    expect(text).toMatch(/RTX 5060/)
    expect(text).not.toMatch(/RTX 5080/)
    expect(text).toContain('16GB DDR5-5600')
    expect(text).toContain('1TB PCIe Gen4')
  })

  it('uses the official 14-inch HP 245 G10 chassis, not a 15.6-inch guess', () => {
    const text = buildLaptopSalesDescription(
      'HP NoteBook 245 G10 - AMD Ryzen 5  7TH GEN- 16GB 1TB ',
    )
    expect(text).toMatch(/14-inch/)
    expect(text).not.toMatch(/15\.6/)
  })

  it('uses the official 15.6-inch Precision 7510 chassis, not a 17.3-inch guess', () => {
    const text = buildLaptopSalesDescription(
      'Dell Precision 7510 - Intel Xeon, 16GB RAM, 400GB SSD, 2GB Dedicated Graphics',
    )
    expect(text).toMatch(/15\.6-inch/)
    expect(text).not.toMatch(/17\.3/)
  })

  it('skips batteries and all-in-ones', () => {
    expect(shouldSkipLaptopCatalogRow('Battery Lenovo Thinkpad T490s/T495s/18m3pd1 Original')).toBe(true)
    expect(shouldSkipLaptopCatalogRow('Apple iMac 21.5-inch Late 2017 - Intel Core i5, 8GB RAM, 256GB SSD')).toBe(true)
    expect(planLaptopDescriptionUpdate({
      name: 'Battery Lenovo Thinkpad T490s/T495s/18m3pd1 Original',
      description: '',
    }).action).toBe('skip-not-laptop')
  })

  it('matches OmniBook 14-fm0013dx even when the title puts a space in the product number', () => {
    const text = buildLaptopSalesDescription(
      'HP Omnibook Xflip 14 -fm0013dx 2IN1 16GB RAM - 512GB SSD - (1920*1200)',
    )
    expect(text).toMatch(/Ultra 5 226V/)
    expect(text).toMatch(/Arc 130V/)
    expect(text).toMatch(/Thunderbolt 4/)
    expect(text).toMatch(/400 nits/)
  })

  it('does not overwrite an already detailed description', () => {
    const detailed = 'Intel Core Ultra 7 256V up to 4.8GHz, 16GB LPDDR5x-8533 onboard RAM, 1TB PCIe Gen4 NVMe M.2 SSD, 14-inch 2K multi-touch display (1920 x 1200), 400 nits, Intel Arc 140V GPU (8GB), Thunderbolt 4, HDMI 2.1, 1-year warranty.'
    expect(planLaptopDescriptionUpdate({
      name: 'HP OmniBook X Flip 2-in-1 14-fm0023dx',
      description: detailed,
    }).action).toBe('skip-detailed')
  })
})
