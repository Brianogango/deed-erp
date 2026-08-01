/** Lazy-load SheetJS only when an import/export handler actually needs it. */
export type XlsxModule = typeof import('xlsx')

let cached: Promise<XlsxModule> | null = null

export function loadXlsx(): Promise<XlsxModule> {
  if (!cached) cached = import('xlsx')
  return cached
}
