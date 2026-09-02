from pathlib import Path
import re

sales = Path('components/modules/Sales.tsx')
text = sales.read_text()

marker = """  const canCreateInvoiceNow = useMemo(() => {\n    if (!activeOrder || activeOrder.status !== 'sale') return false\n"""
replacement = """  const canCreateInvoiceNow = useMemo(() => {\n    if (!activeOrder || activeOrder.status !== 'sale') return false\n    // Deed policy: a Sales Order cannot create a customer invoice before\n    // fulfilment is fully delivered. Pro-forma/deposit collection is separate.\n    if (saleOrderFulfilmentStatus(activeOrder.status, activeOrder.lines ?? []) !== 'delivered') return false\n"""
if marker not in text:
    raise SystemExit('canCreateInvoiceNow marker not found')
text = text.replace(marker, replacement, 1)

text, n = re.subn(
    r"\s*\.\.\.\(canInvoiceFromSO && !canCreateInvoiceNow \? \[\{\s*label: 'Create down payment…',.*?\}\] : \[\]\),",
    '', text, count=1, flags=re.S,
)
if n != 1:
    raise SystemExit('SO down-payment menu block not found')

text, n = re.subn(
    r"onClick=\{\(\) => \{\s*setInvoiceWizardMode\(canCreateInvoiceNow \? 'regular' : 'down_payment_percent'\)\s*setInvoiceWizardPercent\('30'\)\s*setInvoiceWizardAmount\(''\)\s*setShowInvoiceWizard\(true\)\s*\}\}\s*>\s*\{canCreateInvoiceNow \? 'Create invoice…' : 'Create down payment…'\}",
    """onClick={() => {\n                                          if (!canCreateInvoiceNow) {\n                                            void openDeliveryView()\n                                            return\n                                          }\n                                          setInvoiceWizardMode('regular')\n                                          setInvoiceWizardPercent('30')\n                                          setInvoiceWizardAmount('')\n                                          setShowInvoiceWizard(true)\n                                        }}\n                                      >\n                                        {canCreateInvoiceNow ? 'Create invoice…' : 'Complete delivery'}""",
    text, count=1, flags=re.S,
)
if n != 1:
    raise SystemExit('Invoice panel pre-delivery CTA not found')

sales.write_text(text)

route = Path('app/api/sale-orders/[id]/create-invoice/route.ts')
api = route.read_text()
api, n = re.subn(
    r"\n    // ── Down-payment invoice \(deposit\).*?\n    const deliveries = Array\.isArray\(state\.deed_deliveries\)",
    """\n    // A pre-delivery request for funds must use Pro-forma / Deposits, not a\n    // customer invoice. This route is strictly delivery-first.\n    if (isDownPaymentMode(mode)) {\n      return NextResponse.json({\n        error: 'Create a pro-forma or record a customer deposit. An invoice can only be created after delivery is validated.',\n      }, { status: 409 })\n    }\n\n    const deliveries = Array.isArray(state.deed_deliveries)""",
    api, count=1, flags=re.S,
)
if n != 1:
    raise SystemExit('Down-payment API block not found')

insert_after = """    }))\n\n    let invoiceable = healedItems.map(item => {\n"""
strict_gate = """    }))\n\n    const fullyDelivered = healedItems\n      .filter(item => Number(item.qty) > 0)\n      .every(item => Number(item.qtyDelivered) >= Number(item.qty))\n\n    if (!hasValidatedDelivery || !fullyDelivered) {\n      return NextResponse.json({\n        error: 'Complete and validate the Sales Order delivery before creating an invoice',\n      }, { status: 409 })\n    }\n\n    let invoiceable = healedItems.map(item => {\n"""
if insert_after not in api:
    raise SystemExit('invoiceable insertion marker not found')
api = api.replace(insert_after, strict_gate, 1)
route.write_text(api)
