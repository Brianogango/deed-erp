import { describe, expect, it } from 'vitest'
import {
  isRamComponentProduct,
  isStorageComponentProduct,
  ramComponentProducts,
  storageComponentProducts,
} from '@/lib/reconfiguration/part-catalog'

describe('reconfiguration part catalog', () => {
  it('keeps RAM modules and drops laptop titles that mention RAM', () => {
    const ram = { id: 'ram-1', name: '16GB DDR4 SODIMM Laptop RAM - 3200MHz', category: 'Parts & Components' }
    const laptop = {
      id: 'lap-1',
      name: 'Lenovo ThinkPad T14s Gen 2 - 11th Gen Intel Core i5, 16GB RAM, 256GB SSD',
      category: 'Laptops',
    }
    expect(isRamComponentProduct(ram)).toBe(true)
    expect(isRamComponentProduct(laptop)).toBe(false)
    expect(ramComponentProducts([ram, laptop])).toEqual([ram])
  })

  it('keeps SSD modules and drops complete devices from the storage picker', () => {
    const ssd = { id: 'ssd-1', name: '512GB NVMe SSD - M.2 2280 PCIe', category: 'Parts & Components' }
    const travelmate = { id: 'lap-2', name: 'Acer TravelMate P645', category: 'Laptops' }
    const macbook = { id: 'lap-3', name: 'Apple MacBook Air 2015', category: 'Laptops' }
    expect(isStorageComponentProduct(ssd)).toBe(true)
    expect(isStorageComponentProduct(travelmate)).toBe(false)
    expect(isStorageComponentProduct(macbook)).toBe(false)
    expect(storageComponentProducts([ssd, travelmate, macbook])).toEqual([ssd])
  })

  it('does not treat a serialized laptop SKU as a RAM stick', () => {
    expect(isRamComponentProduct({
      id: 'lap-4',
      name: 'Dell Latitude 3400',
      category: 'Laptops',
      trackingMethod: 'SERIAL',
    })).toBe(false)
  })
})
