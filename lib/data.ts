// Essential seed data for Deed ERP - TypeScript FIXED
// Unblocks all modules. Replace localStorage demo data in store.tsx

import type {
  Product, SaleOrder, RepairOrder, PurchaseOrder, SerialNumber, Employee, Contact, Account
} from './store'
export { uid, seq, now, addDays } from './utils'
import { now } from './utils'

// ─── PRODUCTS (Realistic Kenyan IT hardware catalog) ─────────────────────────
export const SEED_PRODUCTS: Product[] = [
  // Laptops
  { id: 'p1', name: 'HP Pavilion 15 (i5-12th)', sku: 'HP15-I5', barcode: '123456789012', category: 'Laptops' as const, salePrice: 85000, costPrice: 68000, taxRate: 16, stockQty: 8, minStock: 2, unit: 'unit', description: '15.6" FHD, 8GB RAM, 512GB SSD, Win11', canBeSold: true, canBePurchased: true, image: '/products/hp-pavilion.jpg', isActive: true, warrantyMonths: 12, requiresSerial: true, saleAccountCode: '5001', costAccountCode: '6101' },
  { id: 'p2', name: 'Dell Latitude 3520', sku: 'DL3520', barcode: '234567890123', category: 'Laptops' as const, salePrice: 72000, costPrice: 58000, taxRate: 16, stockQty: 5, minStock: 3, unit: 'unit', description: '15.6" FHD, i5, 8GB, 256GB SSD', canBeSold: true, canBePurchased: true, image: '/products/dell-3520.jpg', isActive: true, warrantyMonths: 12, requiresSerial: true, saleAccountCode: '5001', costAccountCode: '6101' },
  
  // Desktops
  { id: 'p3', name: 'HP Desktop EliteDesk 800 G6', sku: 'HP800G6', barcode: '345678901234', category: 'Desktops' as const, salePrice: 95000, costPrice: 76000, taxRate: 16, stockQty: 3, minStock: 1, unit: 'unit', description: 'i7, 16GB RAM, 512GB SSD + 1TB HDD', canBeSold: true, canBePurchased: true, image: '/products/hp-elitedesk.jpg', isActive: true, warrantyMonths: 12, requiresSerial: true, saleAccountCode: '5002', costAccountCode: '6102' },
  
  // Parts (Non-serialized)
  { id: 'p4', name: '32GB DDR4 RAM (2x16GB)', sku: 'RAM32GB', barcode: '456789012345', category: 'Parts & Components' as const, salePrice: 12000, costPrice: 8500, taxRate: 16, stockQty: 25, minStock: 5, unit: 'kit', description: 'Kingston 3200MHz CL16', canBeSold: true, canBePurchased: true, image: '/products/ram32gb.jpg', isActive: true, warrantyMonths: 36, requiresSerial: false, saleAccountCode: '5003', costAccountCode: '6103' },
  { id: 'p5', name: '500GB NVMe SSD', sku: 'SSD500GB', barcode: '567890123456', category: 'Parts & Components' as const, salePrice: 6500, costPrice: 4800, taxRate: 16, stockQty: 18, minStock: 3, unit: 'unit', description: 'Samsung 970 EVO Plus', canBeSold: true, canBePurchased: true, image: '/products/ssd500gb.jpg', isActive: true, warrantyMonths: 36, requiresSerial: false, saleAccountCode: '5003', costAccountCode: '6103' },
  
  // Services (No stock)
  { id: 'p6', name: 'Windows 11 Pro License', sku: 'WIN11PRO', barcode: '', category: 'Services' as const, salePrice: 18000, costPrice: 12000, taxRate: 16, stockQty: 999, minStock: 0, unit: 'license', description: 'Genuine OEM license + installation', canBeSold: true, canBePurchased: false, image: '/products/win11.jpg', isActive: true, warrantyMonths: 12, requiresSerial: false, saleAccountCode: '5121', costAccountCode: '6301' },
]

// ─── CUSTOMERS (Real Kenyan businesses) ──────────────────────────────────────
export const SEED_CONTACTS: Contact[] = [
  { id: 'c1', type: 'company', name: 'Nairobi Water & Sewerage Co', tradingName: 'NAWASCO', vatNumber: 'P051123456X', email: 'procurement@nawasco.go.ke', phone: '+254202123456', address: 'P.O. Box 30521-00100, Nairobi', postalAddress: '', city: 'Nairobi', country: 'Kenya', isCustomer: true, isVendor: false, industry: 'Utilities', tags: ['government', 'enterprise'], creditLimit: 500000, paymentTermsDays: 60, paymentTerms: '60 days', bankName: 'NCBA', bankAccount: '1005157785', createdAt: now() },
  { id: 'c2', type: 'company', name: 'ABC Primary School', vatNumber: 'P051234567Y', email: 'admin@abcprimary.ac.ke', phone: '+254712345678', address: 'Kilimani, Nairobi', postalAddress: '', city: 'Nairobi', country: 'Kenya', isCustomer: true, isVendor: false, industry: 'Education', tags: ['education', 'sme'], creditLimit: 150000, paymentTermsDays: 30, paymentTerms: '30 days', bankName: 'Equity Bank', bankAccount: '0670200000', createdAt: now() },
  { id: 'c3', type: 'individual', name: 'John Kamau', idNumber: '34567890', email: 'john.kamau@email.com', phone: '+254722334455', address: 'Kariobangi, Nairobi', postalAddress: '', city: 'Nairobi', country: 'Kenya', isCustomer: true, isVendor: false, tags: ['retail'], paymentTermsDays: 0, paymentTerms: 'cash', createdAt: now() },
]

// ─── SERIALS (Sample tracked inventory) ─────────────────────────────────────
export const SEED_SERIALS: SerialNumber[] = [
  { id: 's1', serial: 'HP15-ABC123', productId: 'p1', productName: 'HP Pavilion 15 (i5-12th)', location: 'shop', status: 'available', receivedDate: now(), barcode: 'HP15-ABC123' },
  { id: 's2', serial: 'HP15-DEF456', productId: 'p1', productName: 'HP Pavilion 15 (i5-12th)', location: 'warehouse', status: 'available', receivedDate: now(), barcode: 'HP15-DEF456' },
  { id: 's3', serial: 'DL3520-GHI789', productId: 'p2', productName: 'Dell Latitude 3520', location: 'shop', status: 'available', receivedDate: now(), barcode: 'DL3520-GHI789' },
  { id: 's4', serial: 'HP800-XYZ001', productId: 'p3', productName: 'HP Desktop EliteDesk 800 G6', location: 'warehouse', status: 'under_repair', receivedDate: now(), barcode: 'HP800-XYZ001' },
]

// ─── SAMPLE SALE ORDERS ─────────────────────────────────────────────────────
export const SEED_SALE_ORDERS: SaleOrder[] = [
  {
    id: 'so1', ref: 'SO/0001', status: 'delivered',
    customerId: 'c1', customerName: 'Nairobi Water & Sewerage Co',
    date: now(), validUntil: now(),
    lines: [
      { id: 'l1', productId: 'p1', productName: 'HP Pavilion 15 (i5-12th)', qty: 3, unitPrice: 85000, discount: 5, taxRate: 16, subtotal: 242250, serialIds: ['s1'], sourceLocation: 'warehouse' },
    ],
    subtotal: 242250, taxTotal: 38760, total: 281010, notes: 'Govt PO #NAW-0456',
    createdByUserId: 'u6', createdByName: 'Grace Njeri',
  },
]

// ─── SAMPLE REPAIRS (COMPLETE RepairOrder) ───────────────────────────────────
export const SEED_REPAIRS: RepairOrder[] = [
  {
    id: 'r1', ref: 'REP/0001', status: 'in_repair',
    customerId: 'c2', customerName: 'ABC Primary School', customerPhone: '+254712345678', customerEmail: 'admin@abcprimary.ac.ke',
    productId: 'p3', productName: 'HP Desktop EliteDesk 800 G6', serialNumber: 'HP800-XYZ001', serialId: 's4',
    deviceCondition: 'fair' as const,
    intakeChannel: 'walk_in', intakeDate: now(), intakeNotes: 'School computer lab unit', issueDescription: 'No power, suspect PSU',
    accessories: [{ name: 'Keyboard', received: true }, { name: 'Mouse', received: false }],
    repairPath: 'diagnosis_first', diagnosisStopped: false,
    underWarranty: false, warrantyId: '',
    assignedTechnicianId: 'u4', assignedTechnicianName: 'James Otieno',
    partsUsed: [], laborCost: 2500, logisticsCost: 0, total: 2500,
    qcItems: [],
    deliveryMethod: 'pickup', deliveryScheduledDate: '', deliveryActualDate: '', deliveryAddress: '', deliveryRecipient: '',
    createdBy: 'admin', bookedByName: 'Reception', createdDate: now(),
    notes: 'Priority: School computer lab',
    closedDate: '',
    slaMissed: false, estimatedCompletionDate: now(),
    // Legacy
    date: now(), description: 'No power, suspect PSU', technicianName: 'James Otieno',
    intakeSource: 'customer',
  },
]

// Initialize in store.tsx: 
// import { SEED_PRODUCTS, SEED_CONTACTS /* etc */ } from './data'
// const [products, setProducts] = useLS('deed_products', SEED_PRODUCTS)
