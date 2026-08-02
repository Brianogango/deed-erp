'use client'
import { useState, useEffect } from 'react'
import { useCommerceStore, fmtKes } from '@/lib/store'
import { useRouter } from 'next/navigation'
import { Badge, PanelHeader, Field, Input, ModuleSkeleton, ModuleHeader, TabBar } from '@/components/ui'
import { Fa } from '@/components/icons'
import { faGlobe, faBoxesStacked, faBriefcase, faChartSimple } from '@fortawesome/free-solid-svg-icons'
import { DataTable, type ColumnDef } from '@/components/data-table'

type OnlineOrder = {
  id: string
  customer: string
  product: string
  total: number
  status: string
  date: string
}

export default function Ecommerce() {
  const { products, setModule } = useCommerceStore()
  const [mounted, setMounted] = useState(() => typeof window !== 'undefined')
  useEffect(() => { setMounted(true) }, [])

  const [tab, setTab] = useState<'products' | 'orders' | 'settings'>('products')
  const [settings, setSettings] = useState({ storeName: 'Deed Technologies Online Store', currency: 'KES', taxIncluded: true, shippingFee: 500 })
  const router = useRouter()

  const listedProducts = products.filter(p => p.canBeSold && p.isActive)

  const onlineOrders: OnlineOrder[] = [
    { id: 'WEB-001', customer: 'Grace Akinyi',   product: 'iPhone 15 Pro 256GB', total: 84500, status: 'confirmed', date: '2026-04-13' },
    { id: 'WEB-002', customer: 'Brian K.',        product: 'AirPods Pro 2nd Gen', total: 28500, status: 'paid',      date: '2026-04-13' },
    { id: 'WEB-003', customer: 'Mary Wanjiku',    product: 'Apple Watch S9 GPS',  total: 65000, status: 'pending',   date: '2026-04-14' },
  ]

  type ProductRow = typeof listedProducts[number]

  const productColumns: ColumnDef<ProductRow>[] = [
    {
      key: 'image', label: '', priority: 1, width: '36px',
      render: p => <span className="text-xl">{p.image}</span>,
      exportValue: () => '',
    },
    {
      key: 'name', label: 'Product', priority: 1, width: '1.6fr',
      render: p => (
        <div>
          <p className="font-medium">{p.name}</p>
          <p className="text-[10px] text-t3">{p.sku}</p>
        </div>
      ),
      accessor: p => `${p.name} ${p.sku}`,
      exportValue: p => p.name,
    },
    {
      key: 'category', label: 'Category', priority: 2, width: '80px',
      render: p => <span className="text-[11px] text-t2">{p.category}</span>,
      exportValue: p => p.category,
    },
    {
      key: 'price', label: 'Price', priority: 1, width: '80px',
      render: p => <span className="font-mono text-[11px]">{fmtKes(p.salePrice)}</span>,
      exportValue: p => p.salePrice,
    },
    {
      key: 'stock', label: 'Stock', priority: 2, width: '70px',
      render: p => (
        <span className="font-mono text-[11px]" style={{ color: p.stockQty === 0 ? 'var(--danger)' : p.stockQty <= p.minStock ? 'var(--warning)' : 'var(--success)' }}>
          {p.unit === 'service' ? '∞' : p.stockQty}
        </span>
      ),
      exportValue: p => p.unit === 'service' ? 'service' : p.stockQty,
    },
    {
      key: 'listed', label: 'Listed', priority: 1, width: '80px',
      render: p => (
        <Badge status={p.stockQty > 0 || p.unit === 'service' ? 'active' : 'cancelled'} label={p.stockQty > 0 || p.unit === 'service' ? 'Live' : 'OOS'} />
      ),
      accessor: p => (p.stockQty > 0 || p.unit === 'service' ? 'Live' : 'OOS'),
      exportValue: p => (p.stockQty > 0 || p.unit === 'service' ? 'Live' : 'OOS'),
    },
  ]

  const orderColumns: ColumnDef<OnlineOrder>[] = [
    {
      key: 'id', label: 'Order', priority: 1, width: '80px',
      render: o => <span className="font-mono text-[10px] font-semibold" style={{ color: 'var(--navy)' }}>{o.id}</span>,
      accessor: o => o.id,
      exportValue: o => o.id,
    },
    {
      key: 'customer', label: 'Customer', priority: 1, width: '1.3fr',
      render: o => <span>{o.customer}</span>,
      exportValue: o => o.customer,
    },
    {
      key: 'product', label: 'Product', priority: 2, width: '1.5fr',
      render: o => <span className="text-[11px] text-t2">{o.product}</span>,
      exportValue: o => o.product,
    },
    {
      key: 'total', label: 'Total', priority: 1, width: '90px',
      render: o => <span className="font-mono text-[11px]">{fmtKes(o.total)}</span>,
      exportValue: o => o.total,
    },
    {
      key: 'status', label: 'Status', priority: 1, width: '70px',
      render: o => <Badge status={o.status} />,
      accessor: o => o.status,
      exportValue: o => o.status,
    },
  ]

  if (!mounted) return <ModuleSkeleton />

  return (
    <div className="mod-page">
      <ModuleHeader
        title="E-commerce"
        subtitle="Online store management"
        icon={<Fa icon={faGlobe} />}
        count={listedProducts.length}
        color="var(--primary)"
      />

      <TabBar
        tabs={[
          { id: 'products', label: 'Products' },
          { id: 'orders', label: 'Orders' },
          { id: 'settings', label: 'Settings' },
        ]}
        active={tab}
        onChange={id => setTab(id as typeof tab)}
        maxVisibleDesktop={6}
        ariaLabel="E-commerce sections"
      />

      <div className="mod-body p-3 sm:p-4 flex flex-col gap-4">
      <div className="card overflow-hidden">
        {tab === 'products' && (
          <>
            <PanelHeader title="Store Products" count={listedProducts.length} />
            <DataTable
              tableId="ecommerce-products"
              columns={productColumns}
              rows={listedProducts}
              rowKey={p => p.id}
              searchPlaceholder="Search products…"
              emptyMessage="No products listed"
              rowActions={() => (
                <button style={{ background: '#E8F3FA', border: '1px solid #A8D4E8', cursor: 'pointer', color: 'var(--navy)', fontSize: 10, borderRadius: 6, padding: '3px 10px' }}>
                  View
                </button>
              )}
              exportTitle="Store Products"
              exportFilename="ecommerce-products"
            />
          </>
        )}

        {tab === 'orders' && (
          <>
            <PanelHeader title="Online Orders" count={onlineOrders.length}>
              <span className="text-[10px] text-t3">Sync with Sales module to process</span>
            </PanelHeader>
            <DataTable
              tableId="ecommerce-orders"
              columns={orderColumns}
              rows={onlineOrders}
              rowKey={o => o.id}
              searchPlaceholder="Search orders…"
              emptyMessage="No online orders"
              rowActions={() => (
                <button className="btn-outline text-[10px] py-0.5 px-2" onClick={() => { setModule('sales'); router.push('/sales'); }}>→ Sales</button>
              )}
              exportTitle="Online Orders"
              exportFilename="ecommerce-orders"
            />
          </>
        )}

        {tab === 'settings' && (
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Store Name"><Input value={settings.storeName} onChange={v => setSettings(p => ({ ...p, storeName: v }))} /></Field>
            <Field label="Currency"><Input value={settings.currency} onChange={v => setSettings(p => ({ ...p, currency: v }))} /></Field>
            <Field label="Shipping Fee (KES)"><Input value={String(settings.shippingFee)} onChange={v => setSettings(p => ({ ...p, shippingFee: Number(v) }))} type="number" /></Field>
            <div className="flex items-center gap-2 pt-4">
              <input type="checkbox" checked={settings.taxIncluded} onChange={e => setSettings(p => ({ ...p, taxIncluded: e.target.checked }))} style={{ accentColor: 'var(--navy)', width: 16, height: 16 }} />
              <label className="text-xs text-t1">Tax included in displayed price</label>
            </div>
            <div className="col-span-2">
              <button className="btn-primary">Save Settings</button>
            </div>
          </div>
        )}
      </div>{/* card */}

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: faBoxesStacked, title: 'Manage Products',  desc: 'Add, edit, set prices & stock',        action: () => { setModule('inventory'); router.push('/operations'); },  color: 'var(--warning)' },
          { icon: faBriefcase, title: 'Process as Sale',  desc: 'Convert online orders to sale orders', action: () => { setModule('sales'); router.push('/sales'); },      color: '#8B5CF6' },
          { icon: faChartSimple, title: 'View Accounting',  desc: 'Online revenue in accounting',         action: () => { setModule('accounting'); router.push('/finance'); }, color: 'var(--success)' },
        ].map(c => (
          <button key={c.title} onClick={c.action}
            className="card p-4 text-left cursor-pointer transition-all flex flex-col gap-2"
            onMouseOver={e => { (e.currentTarget as HTMLElement).style.borderColor = c.color }}
            onMouseOut={e => { (e.currentTarget as HTMLElement).style.borderColor = '' }}>
            <span className="text-2xl" style={{ color: c.color }} aria-hidden="true"><Fa icon={c.icon} /></span>
            <p className="text-xs font-semibold text-t1">{c.title}</p>
            <p className="text-[10px] text-t3">{c.desc}</p>
          </button>
        ))}
      </div>
      </div>{/* mod-body */}
    </div>
  )
}
