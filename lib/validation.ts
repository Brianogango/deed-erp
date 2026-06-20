import { z } from 'zod'

/**
 * Common validation schemas for the ERP system.
 * Using Zod ensures that input is correctly typed and sanitized before processing.
 */

export const productSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters").max(200),
  sku: z.string().max(50).optional().nullable(),
  barcode: z.string().max(100).optional().nullable(),
  category: z.string().min(1, "Category is required"),
  salePrice: z.number().nonnegative("Sale price cannot be negative"),
  costPrice: z.number().nonnegative("Cost price cannot be negative"),
  taxRate: z.number().min(0).max(100).default(16),
  minStock: z.number().int().nonnegative().default(5),
  description: z.string().max(1000).optional().nullable(),
  isActive: z.boolean().default(true),
  trackStock: z.boolean().default(true),
})

export const userUpdateSchema = z.object({
  username: z.string().min(3).max(50).optional(),
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional().nullable(),
  role: z.string().optional(),
  modules: z.array(z.string()).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
  mustChangePassword: z.boolean().optional(),
})

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
})

export const validate = async <T>(schema: z.Schema<T>, data: unknown): Promise<T> => {
  try {
    return await schema.parseAsync(data)
  } catch (error) {
    if (error instanceof z.ZodError) {
      // ZodError has an 'issues' property, not 'errors'
      const message = error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      const err = new Error(message)
      ;(err as any).status = 400
      throw err
    }
    throw error
  }
}
