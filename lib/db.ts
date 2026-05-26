import Dexie, { Table } from 'dexie';

export interface OfflinePOSOrder {
  id: string;
  ref: string;
  sessionId: string;
  lines: {
    productId: string;
    productName: string;
    barcode: string;
    qty: number;
    price: number;
    subtotal: number;
    serialId?: string;
    serialNumber?: string;
  }[];
  subtotal: number;
  taxTotal: number;
  total: number;
  payment: 'cash' | 'mpesa' | 'card';
  customerId?: string;
  customerName?: string;
  date: string;
  createdAt: string;
  createdByUserId?: string;
  createdByName?: string;
  pointsEarned?: number;
  pointsRedeemed?: number;
  synced: boolean;
}

export class DeedDatabase extends Dexie {
  offline_pos_sales!: Table<OfflinePOSOrder>;

  constructor() {
    super('deed-erp-offline');
    this.version(1).stores({
      offline_pos_sales: 'id, ref, synced, date'
    });
  }
}

export const db = new DeedDatabase();
