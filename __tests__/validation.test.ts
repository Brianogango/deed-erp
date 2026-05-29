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
    expect(result.taxRate).toBe(16) // default
    expect(result.isActive).toBe(true) // default
  })

  it('rejects name shorter than 3 chars', async () => {
    await expect(productSchema.parseAsync({ ...valid, name: 'Ab' })).rejects.toThrow()
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
