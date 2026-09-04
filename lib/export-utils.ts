'use client'

import {
  exportToCsv,
  exportToExcel as exportGenericToExcel,
  exportToPDF as exportGenericToPDF,
  type ExportRow,
} from '@/lib/export-utils-base'

export type { ExportRow } from '@/lib/export-utils-base'
export { exportToCsv }

const isClientCatalog = (title: string) => title.trim().toLowerCase() === 'product catalog'

/**
 * Product Catalog is customer-facing: it deliberately does not expose cost,
 * GP/margin, condition, category or price-history metadata. Every other module
 * keeps the existing generic Excel exporter unchanged.
 */
export async function exportToExcel(
  title: string,
  headers: string[],
  rows: ExportRow[],
  filename: string,
) {
  if (isClientCatalog(title)) {
    const { exportClientCatalogExcelFromTable } = await import('@/lib/inventory/client-catalog-export')
    return exportClientCatalogExcelFromTable(headers, rows, filename)
  }
  return exportGenericToExcel(title, headers, rows, filename)
}

/**
 * Keep the generic PDF path synchronous for existing reports. Product Catalog
 * loads its richer branded renderer on demand and returns that promise.
 */
export function exportToPDF(
  title: string,
  headers: string[],
  rows: ExportRow[],
  filename: string,
  orientation: 'portrait' | 'landscape' = 'landscape',
): void | Promise<void> {
  if (isClientCatalog(title)) {
    return import('@/lib/inventory/client-catalog-export').then(({ exportClientCatalogPdfFromTable }) =>
      exportClientCatalogPdfFromTable(headers, rows, filename),
    )
  }
  exportGenericToPDF(title, headers, rows, filename, orientation)
}
