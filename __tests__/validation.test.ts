import { describe, it, expect } from 'vitest'
import { loginSchema, productSchema, userUpdateSchema, validate } from '@/lib/validation'

describe('loginSchema', () => {
  it('accepts valid credentials', async () => {
    const result = await loginSchema.parseAsync({ username: 'admin', password: 'secret' })
    expect(result).toEqual({ username: 'admin', password: 'secret' })
  })

  it('rejects empty username', async () => {
    await expect(loginSchema.parseAsync({ username: '', password: 'secret' })).rejects.toThrow()
  })

  it('rejects empty password', async () => {
    await expect(loginSchema.parseAsync({ username: 'admin', password: '' })).rejects.toThrow()
  })

  it('rejects missing fields', async () => {
    await expect(loginSchema.parseAsync({})).rejects.toThrow()
  })
})

describe('validate()', () => {
  it('returns parsed data on success', async () => {
    const result = await validate(loginSchema, { username: 'user', password: 'pass' })
    expect(result.username).toBe('user')
  })

  it('throws a human-readable error on failure', async () => {
    await expect(validate(loginSchema, { username: '' })).rejects.toThrow()
  })

  it('error message contains field name', async () => {
    let msg = ''
    try {
      await validate(loginSchema, { username: '', password: '' })
    } catch (e: any) {
      msg = e.message
    }
    expect(msg).toContain('username')
  })
})

describe('productSchema', () => {
  const valid = {
    name: 'iPhone 15 Pro',
    sku: 'IPH-15P',
    category: 'phones',
    salePrice: 150000,
    costPrice: 120000,
  }

  it('accepts valid product', async () => {
    const result = await productSchema.parseAsync(valid)
    expect(result.name).toBe('iPhone 15 Pro')
    expect(result.taxRate).toBe(0) // VAT is opt-in
    expect(result.isActive).toBe(true) // default
  })

  it('keeps VAT when the user explicitly selects it', async () => {
    const result = await productSchema.parseAsync({ ...valid, taxRate: 16 })
    expect(result.taxRate).toBe(16)
  })

  it('accepts vendor titles longer than 200 characters', async () => {
    const name = 'Lenovo V14 G5 IRL/14" FHD (1920x1080) TN 250nits Anti-glare, 45% NTSC/Intel Core i5-13420H, 8C (4P + 4E) / 12T, P-core up to 4.6GHz, E-core up to 3.4GHz, 12MB Intel Smart Cache/8GB SODIMM DDR5-5200/512GB SSD M.2 2242 PCIe 4.0x4 NVMe/SH/Non-backlit, English (UK)/Wi-Fi 6, 802.11ax 2x2 + BT5.2/DOS/1-year, Courier or Carry-in/Business Black'
    expect(name.length).toBeGreaterThan(200)
    const result = await productSchema.parseAsync({ ...valid, name })
    expect(result.name).toBe(name)
  })

  it('rejects negative sale price', async () => {
    await expect(productSchema.parseAsync({ ...valid, salePrice: -1 })).rejects.toThrow()
  })

  it('rejects negative cost price', async () => {
    await expect(productSchema.parseAsync({ ...valid, costPrice: -100 })).rejects.toThrow()
  })

  it('accepts optional barcode as null', async () => {
    const result = await productSchema.parseAsync({ ...valid, barcode: null })
    expect(result.barcode).toBeNull()
  })

  it('accepts productType and pricingCategoryId', async () => {
    const result = await productSchema.parseAsync({
      ...valid,
      productType: 'refurbished',
      pricingCategoryId: 'refurb_laptops',
    })
    expect(result.productType).toBe('refurbished')
    expect(result.pricingCategoryId).toBe('refurb_laptops')
  })

  it('accepts optional commissionRatePercent override', async () => {
    const result = await productSchema.parseAsync({ ...valid, commissionRatePercent: 4.5 })
    expect(result.commissionRatePercent).toBe(4.5)
  })

  it('rejects commissionRatePercent above 100', async () => {
    await expect(productSchema.parseAsync({ ...valid, commissionRatePercent: 101 })).rejects.toThrow()
  })
})

describe('userUpdateSchema', () => {
  it('accepts partial updates', async () => {
    const result = await userUpdateSchema.parseAsync({ name: 'Alice' })
    expect(result.name).toBe('Alice')
  })

  it('rejects password shorter than 8 chars', async () => {
    await expect(userUpdateSchema.parseAsync({ password: 'short' })).rejects.toThrow()
  })

  it('rejects invalid email', async () => {
    await expect(userUpdateSchema.parseAsync({ email: 'not-an-email' })).rejects.toThrow()
  })

  it('accepts empty object (all fields optional)', async () => {
    const result = await userUpdateSchema.parseAsync({})
    expect(result).toEqual({})
  })
})

describe('userUpdateSchema actsAsTechnician', () => {
  it('preserves actsAsTechnician instead of stripping it', async () => {
    const result = await validate(userUpdateSchema, {
      name: 'Cynthia',
      actsAsTechnician: true,
      modules: ['dashboard', 'kilimall', 'repair'],
    })
    expect(result.actsAsTechnician).toBe(true)
  })
})

