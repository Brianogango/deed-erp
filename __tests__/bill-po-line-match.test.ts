import { describe, it, expect } from 'vitest'
import { purchaseLineName, resolveVendorBillPoItem } from '@/lib/purchase/bill-po-line-match'

const laptop = {
  id: 'po-item-1',
  productId: 'prisma-product',
  description: 'HP Omnibook X Flip 14-KP0023DX X360 - Ultra 7 355, 24GB RAM, 512GB SSD, 14” 2K (1920x1200) display, Touchscreen, Windows 11 home',
}

describe('resolveVendorBillPoItem', () => {
  it('matches by purchaseOrderItemId first', () => {
    const other = { id: 'po-item-2', productId: 'other', description: 'Other' }
    expect(resolveVendorBillPoItem([laptop, other], {
      purchaseOrderItemId: 'po-item-2',
      productId: 'prisma-product',
      description: laptop.description,
    })?.id).toBe('po-item-2')
  })

  it('matches by productId when unique', () => {
    expect(resolveVendorBillPoItem([laptop], {
      productId: 'prisma-product',
      description: 'unrelated',
    })?.id).toBe('po-item-1')
  })

  it('matches blob bill lines onto Prisma PO items by description', () => {
    expect(resolveVendorBillPoItem([laptop], {
      productId: 'blob-product-id',
      description: `${laptop.description} ×1`,
    })?.id).toBe('po-item-1')
  })

  it('falls back to the only PO line when product ids differ and the bill has no description', () => {
    expect(resolveVendorBillPoItem([laptop], {
      productId: 'blob-product-id',
    })?.id).toBe('po-item-1')
  })

  it('does not guess when two PO lines could match', () => {
    const second = { id: 'po-item-2', productId: 'other', description: 'Lenovo ThinkPad' }
    expect(resolveVendorBillPoItem([laptop, second], {
      productId: 'blob-product-id',
      description: 'Something else ×1',
    })).toBeUndefined()
  })

  it('strips the trailing ×qty suffix from bill descriptions', () => {
    expect(purchaseLineName('Widget ×3')).toBe('widget')
    expect(purchaseLineName('Widget x 3')).toBe('widget')
  })
})
