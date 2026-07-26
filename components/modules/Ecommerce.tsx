'use client'
import { useState, useEffect } from 'react'
import { useCommerceStore, fmtKes } from '@/lib/store'
import { useRouter } from 'next/navigation'
import { Badge, PanelHeader, Field, Input, ModuleSkeleton, ModuleHeader, TabBar } from '@/components/ui'
import { Fa } from '@/components/icons'
import { faGlobe, faTriangleExclamation, faBoxesStacked, faMoneyBillWave, faBriefcase, faChartSimple } from '@fortawesome/free-solid-svg-icons'

export default function Ecommerce() {
  const { products, updateProduct, setModule } = useCommerceStore()
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const [tab, setTab] = useState<'products' | 'orders' | 'settings'>('products')
  const [settings, setSettings] = useState({ storeName: 'Deed Technologies Online Store', currency: 'KES', taxIncluded: true, shippingFee: 500 })
  const router = useRouter()

  const listedProducts = products.filter(p => p.canBeSold && p.isActive)
  const outOfStock = listedProducts.filter(p => p.stockQty === 0 && p.unit !== 'service').length

  const onlineOrders = [
    { id: 'WEB-001', customer: 'Grace Akinyi',   product: 'iPhone 15 Pro 256GB', total: 84500, status: 'confirmed', date: '2026-04-13' },
    { id: 'WEB-002', customer: 'Brian K.',        product: 'AirPods Pro 2nd Gen', total: 28500, status: 'paid',      date: '2026-04-13' },
    { id: 'WEB-003', customer: 'Mary Wanjiku',    product: 'Apple Watch S9 GPS',  total: 65000, status: 'pending',   date: '2026-04-14' },
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
            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-[var(--border-lt)]">
              {listedProducts.map(p => (
                <div key={`m-${p.id}`} className="p-4 flex items-center gap-3">
                  <span className="text-2xl flex-shrink-0">{p.image}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-t1 truncate">{p.name}</p>
                    <p className="text-[10px] text-t3">{p.category} · {p.sku}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs font-bold text-t1">{fmtKes(p.salePrice)}</p>
                    <Badge status={p.stockQty > 0 || p.unit === 'service' ? 'active' : 'cancelled'} label={p.stockQty > 0 || p.unit === 'service' ? 'Live' : 'OOS'} />
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden lg:block">
              <div className="flex flex-col">
            <div className="table-head" style={{ gridTemplateColumns: '36px 1.6fr 80px 80px 70px 80px 80px' }}>
              <span></span><span>Product</span><span>Category</span><span>Price</span><span>Stock</span><span>Listed</span><span>Action</span>
            </div>
            {listedProducts.map(p => (
              <div key={p.id} className="table-row" style={{ gridTemplateColumns: '36px 1.6fr 80px 80px 70px 80px 80px' }}>
                <span className="text-xl">{p.image}</span>
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-[10px] text-t3">{p.sku}</p>
                </div>
                <span className="text-[11px] text-t2">{p.category}</span>
                <span className="font-mono text-[11px]">{fmtKes(p.salePrice)}</span>
                <span className="font-mono text-[11px]" style={{ color: p.stockQty === 0 ? 'var(--danger)' : p.stockQty <= p.minStock ? 'var(--warning)' : 'var(--success)' }}>
                  {p.unit === 'service' ? '∞' : p.stockQty}
                </span>
                <Badge status={p.stockQty > 0 || p.unit === 'service' ? 'active' : 'cancelled'} label={p.stockQty > 0 || p.unit === 'service' ? 'Live' : 'OOS'} />
                <button style={{ background: '#E8F3FA', border: '1px solid #A8D4E8', cursor: 'pointer', color: 'var(--navy)', fontSize: 10, borderRadius: 6, padding: '3px 10px' }}>
                  View
                </button>
              </div>
            ))}
              </div>
            </div>
          </>
        )}

        {tab === 'orders' && (
          <>
            <PanelHeader title="Online Orders" count={onlineOrders.length}>
              <span className="text-[10px] text-t3">Sync with Sales module to process</span>
            </PanelHeader>
            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-[var(--border-lt)]">
              {onlineOrders.map(o => (
                <div key={`m-${o.id}`} className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-[10px] font-bold" style={{ color: 'var(--navy)' }}>{o.id}</span>
                      <Badge status={o.status} />
                    </div>
                    <p className="text-xs font-semibold text-t1 truncate">{o.customer}</p>
                    <p className="text-[10px] text-t3 truncate">{o.product}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs font-bold text-t1">{fmtKes(o.total)}</p>
                    <button className="btn-outline text-[9px] py-0.5 px-2 mt-1" onClick={() => { setModule('sales'); router.push('/sales'); }}>→ Sales</button>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden lg:block">
              <div className="flex flex-col">
            <div className="table-head" style={{ gridTemplateColumns: '80px 1.3fr 1.5fr 90px 70px 70px' }}>
              <span>Order</span><span>Customer</span><span>Product</span><span>Total</span><span>Status</span><span>Process</span>
            </div>
            {onlineOrders.map(o => (
              <div key={o.id} className="table-row" style={{ gridTemplateColumns: '80px 1.3fr 1.5fr 90px 70px 70px' }}>
                <span className="font-mono text-[10px] font-semibold" style={{ color: 'var(--navy)' }}>{o.id}</span>
                <span>{o.customer}</span>
                <span className="text-[11px] text-t2">{o.product}</span>
                <span className="font-mono text-[11px]">{fmtKes(o.total)}</span>
                <Badge status={o.status} />
                <button className="btn-outline text-[10px] py-0.5 px-2" onClick={() => { setModule('sales'); router.push('/sales'); }}>→ Sales</button>
              </div>
            ))}
              </div>
            </div>
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
