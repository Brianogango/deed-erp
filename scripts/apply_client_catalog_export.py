from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Expected text not found in {path}: {old[:120]!r}')
    if text.count(old) != 1:
        raise SystemExit(f'Expected exactly one match in {path}, found {text.count(old)}')
    p.write_text(text.replace(old, new, 1))


# 1) Let a module replace DataTable's generic PDF/Excel exporters while keeping the same toolbar UX.
replace_once(
    'components/data-table/DataTable.tsx',
    "  exportFormats?: Array<'pdf' | 'excel'>\n\n  onRowClick?: (row: T) => void",
    "  exportFormats?: Array<'pdf' | 'excel'>\n  /** Optional module-owned export menu. When supplied it replaces the generic table export. */\n  customExportOptions?: ExportMenuOption[]\n\n  onRowClick?: (row: T) => void",
)
replace_once(
    'components/data-table/DataTable.tsx',
    "  exportFormats = ['pdf', 'excel'],\n  onRowClick,",
    "  exportFormats = ['pdf', 'excel'],\n  customExportOptions,\n  onRowClick,",
)
replace_once(
    'components/data-table/DataTable.tsx',
    "  const exportOptions: ExportMenuOption[] | undefined = useMemo(() => {",
    "  const builtInExportOptions: ExportMenuOption[] | undefined = useMemo(() => {",
)
replace_once(
    'components/data-table/DataTable.tsx',
    "  }, [exportTitle, exportHeaders, exportRows, exportFilename, exportFormats])\n\n  const clearFilters = () => {",
    "  }, [exportTitle, exportHeaders, exportRows, exportFilename, exportFormats])\n  const exportOptions = customExportOptions ?? builtInExportOptions\n\n  const clearFilters = () => {",
)

# 2) Route Inventory Product Catalog PDF/Excel through the client-facing renderer.
replace_once(
    'components/modules/Inventory.tsx',
    "import { printLabelsForSerialUnits } from '@/lib/inventory/print-serial-device-label'",
    "import { printLabelsForSerialUnits } from '@/lib/inventory/print-serial-device-label'\nimport { exportClientCatalogExcel, exportClientCatalogPdf } from '@/lib/inventory/client-catalog-export'",
)
replace_once(
    'components/modules/Inventory.tsx',
    '                    exportTitle="Product Catalog"\n                    exportFilename="inventory-catalog"\n                    perPage={20}',
    '''                    exportTitle="Product Catalog"\n                    exportFilename="inventory-catalog"\n                    customExportOptions={[\n                      {\n                        id: 'pdf',\n                        label: 'Export PDF',\n                        onSelect: () => {\n                          void exportClientCatalogPdf(\n                            catalogProducts,\n                            product => catalogQty(product as Product),\n                            'inventory-catalog',\n                          ).catch(() => showToast('Could not export client catalog PDF', 'error'))\n                        },\n                      },\n                      {\n                        id: 'excel',\n                        label: 'Export Excel',\n                        onSelect: () => {\n                          void exportClientCatalogExcel(\n                            catalogProducts,\n                            product => catalogQty(product as Product),\n                            'inventory-catalog',\n                          ).catch(() => showToast('Could not export client catalog Excel', 'error'))\n                        },\n                      },\n                    ]}\n                    perPage={20}''',
)

# 3) Fine-tune bundling and Excel image behavior in the dedicated client renderer.
replace_once(
    'lib/inventory/client-catalog-export.ts',
    "    .replace(/\\b\\d{1,2}(?:\\.\\d+)?\\s*(?:[\"”]|inch(?:es)?\\b)/ig, ' ')\n    .replace(/\\s*[-,/|]+\\s*$/g, ' ')",
    "    .replace(/\\b\\d{1,2}(?:\\.\\d+)?\\s*(?:[\"”]|inch(?:es)?\\b)/ig, ' ')\n    .replace(/\\b(?:WUXGA|FHD|QHD\\+?|UHD|HD\\+?|2K|4K)\\b/ig, ' ')\n    .replace(/\\s*[-,/|]+\\s*$/g, ' ')",
)
replace_once(
    'lib/inventory/client-catalog-export.ts',
    "function conditionKey(product: ClientCatalogProduct): string {\n  return clean(product.productType).toLowerCase() === 'new' ? 'new' : 'refurbished'\n}\n\n",
    '',
)
replace_once(
    'lib/inventory/client-catalog-export.ts',
    "    const key = `${normaliseForGroup(model)}::${normaliseForGroup(specs)}::${conditionKey(product)}`",
    "    const key = `${normaliseForGroup(model)}::${normaliseForGroup(specs)}`",
)
replace_once(
    'lib/inventory/client-catalog-export.ts',
    "    [[company.website, company.email, company.phone].filter(Boolean).join('   |   ')],",
    "    [[company.website, company.email, company.phone].filter(Boolean).join('   |   ')[0] || ''],",
)
# The previous replacement keeps the row type valid but would only retain one character; replace it with the intended single cell.
replace_once(
    'lib/inventory/client-catalog-export.ts',
    "    [[company.website, company.email, company.phone].filter(Boolean).join('   |   ')[0] || ''],",
    "    [[company.website, company.email, company.phone].filter(Boolean).join('   |   ')].join('')],",
)
# And collapse the temporary expression to a plain one-cell row.
replace_once(
    'lib/inventory/client-catalog-export.ts',
    "    [[company.website, company.email, company.phone].filter(Boolean).join('   |   ')].join('')],",
    "    [[company.website, company.email, company.phone].filter(Boolean).join('   |   ')][0]],",
)
# Final readable form: one scalar string in the row, not a nested array.
replace_once(
    'lib/inventory/client-catalog-export.ts',
    "    [[company.website, company.email, company.phone].filter(Boolean).join('   |   ')][0]],",
    "    [String([company.website, company.email, company.phone].filter(Boolean).join('   |   '))],",
)
replace_once(
    'lib/inventory/client-catalog-export.ts',
    "    const imageCell = ws[XLSX.utils.encode_cell({ r: excelRow, c: 0 })]\n    if (imageCell && row.imageUrl) {\n      imageCell.l = { Target: row.imageUrl, Tooltip: 'Open product image' }\n      imageCell.s = { ...imageCell.s, font: { color: { rgb: BLUE.slice(1) }, underline: true, name: 'Arial', sz: 9 } }\n    }",
    "    const imageCell = ws[XLSX.utils.encode_cell({ r: excelRow, c: 0 })]\n    if (imageCell && row.imageUrl) {\n      if (/^https?:\\/\\//i.test(row.imageUrl)) {\n        imageCell.t = 'n'\n        imageCell.f = `IMAGE(\\\"${row.imageUrl.replace(/\\\"/g, '\\\\\\"')}\\\",\\\"Product image\\\",0)`\n        imageCell.v = undefined\n      } else {\n        imageCell.v = 'View image'\n        imageCell.l = { Target: row.imageUrl, Tooltip: 'Open product image' }\n      }\n      imageCell.s = { ...imageCell.s, font: { color: { rgb: BLUE.slice(1) }, underline: true, name: 'Arial', sz: 9 } }\n    }",
)

# 4) Focused regression coverage for the business-facing export model.
test_path = Path('__tests__/client-catalog-export.test.ts')
test_path.write_text('''import { describe, expect, it } from 'vitest'\nimport { buildClientCatalogRows, clientCatalogModel, clientCatalogSpecs } from '@/lib/inventory/client-catalog-export'\n\nconst base = {\n  id: 'p1',\n  name: 'HP EliteBook 840 G6 - 8th Gen Intel Core i5, 8GB RAM, 256GB SSD, 14\\\" FHD',\n  sku: 'HP-840-G6-A',\n  category: 'Laptops',\n  salePrice: 28000,\n}\n\ndescribe('client catalog export', () => {\n  it('splits model from customer-facing specifications', () => {\n    expect(clientCatalogModel(base)).toContain('HP EliteBook 840 G6')\n    expect(clientCatalogModel(base)).not.toContain('8GB')\n    const specs = clientCatalogSpecs(base)\n    expect(specs).toContain('Intel Core i5')\n    expect(specs).toContain('8GB RAM')\n    expect(specs).toContain('256GB')\n    expect(specs).toContain('14\\\"')\n  })\n\n  it('bundles same model/spec SKUs, sums quantity, and exposes only client values', () => {\n    const products = [\n      base,\n      { ...base, id: 'p2', sku: 'HP-840-G6-B', productType: 'new', salePrice: 30000 },\n    ]\n    const qty = new Map([['p1', 2], ['p2', 3]])\n    const rows = buildClientCatalogRows(products, product => qty.get(product.id) || 0)\n\n    expect(rows).toHaveLength(1)\n    expect(rows[0].qty).toBe(5)\n    expect(rows[0].priceMin).toBe(28000)\n    expect(rows[0].priceMax).toBe(30000)\n    expect(rows[0].priceLabel).toContain('28,000')\n    expect(rows[0].priceLabel).toContain('30,000')\n    expect(Object.keys(rows[0])).not.toContain('costPrice')\n    expect(Object.keys(rows[0])).not.toContain('gp')\n    expect(Object.keys(rows[0])).not.toContain('lastUpdate')\n    expect(Object.keys(rows[0])).not.toContain('category')\n  })\n})\n''')

# Remove helper artifacts from the resulting product commit.
Path('.github/workflows/apply-client-catalog-export.yml').unlink(missing_ok=True)
Path('scripts/apply_client_catalog_export.py').unlink(missing_ok=True)
