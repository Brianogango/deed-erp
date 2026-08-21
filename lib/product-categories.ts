/** ERP product categories — safe to import from server routes (not from `lib/store`). */

export type CategoryId =
  | 'Laptops'
  | 'Desktops'
  | 'Parts & Components'
  | 'Accessories'
  | 'Printers'
  | 'Networking'
  | 'Mobile Devices'
  | 'Software & Licences'
  | 'Services'

export const CATEGORY_CONFIG: Record<CategoryId, { serialRequired: boolean; trackStock: boolean }> = {
  Laptops: { serialRequired: true, trackStock: true },
  Desktops: { serialRequired: true, trackStock: true },
  'Parts & Components': { serialRequired: false, trackStock: true },
  Accessories: { serialRequired: false, trackStock: true },
  Printers: { serialRequired: true, trackStock: true },
  Networking: { serialRequired: true, trackStock: true },
  'Mobile Devices': { serialRequired: true, trackStock: true },
  'Software & Licences': { serialRequired: false, trackStock: false },
  Services: { serialRequired: false, trackStock: false },
}

export const ALL_CATEGORIES = Object.keys(CATEGORY_CONFIG) as CategoryId[]
