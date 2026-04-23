'use client'
import { useApp, fmtKes, fmtDate, ALL_CATEGORIES, ModuleId } from '@/lib/store'
import { Badge } from '@/components/ui'
import { formatRoleLabel } from '@/lib/auth/access'
import { Fa } from '@/components/icons'
import {
  faMoneyBillWave, faArrowDown, faArrowUp, faFileInvoiceDollar,
  faBoxesStacked, faClipboardList, faScrewdriverWrench, faTriangleExclamation,
  faShieldHalved, faDesktop, faUsers, faMoneyCheckDollar, faArrowsRotate, faCartShopping,
} from '@fortawesome/free-solid-svg-icons'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie, Legend,
} from 'recharts'

const CATEGORY_COLORS: Record<string, string> = {
  Laptops:              '#1B2762',
  Desktops:             '#00B0D7',
  'Parts & Components': '#2563EB',
  Accessories:          '#0891B2',
  Printers:             '#059669',
  Networking:           '#D97706',
  Services:             '#DC2626',
}

// ── KPI card — top accent bar, bold value ────────────────────────────────────
function KpiCard({
  label, value, sub, color, icon, onClick,
}: {
  label: string; value: string | number; sub: string
  color: string; icon: React.ReactNode; onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="card text-left w-full"
      style={{
        padding: '18px 20px',
        cursor: onClick ? 'pointer' : 'default',
        borderTop: `3px solid ${color}`,
        borderRadius: 14,
        transition: 'box-shadow 0.18s, transform 0.18s',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseOver={e => {
        if (!onClick) return
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = `0 8px 28px ${color}28`
        el.style.transform = 'translateY(-1px)'
      }}
      onMouseOut={e => {
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)'
        el.style.transform = 'translateY(0)'
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.9px', textTransform: 'uppercase', color: '#9CA3AF' }}>{label}</p>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: color + '18', color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 14 }}>{icon}</span>
        </div>
      </div>
      <p style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1, marginBottom: 5 }}>{value}</p>
      <p style={{ fontSize: 10, color: '#9CA3AF', lineHeight: 1.4 }}>{sub}</p>
    </button>
  )
}

// ── Card header ───────────────────────────────────────────────────────────────
function CardHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: '#F3F4F6' }}>
      <div>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{title}</p>
        {sub && <p style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>{sub}</p>}
      </div>
      {action}
    </div>
  )
}

// ── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ width: 3, height: 13, background: '#1B2762', borderRadius: 2, display: 'inline-block', flexShrink: 0 }} />
      <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1.1px', textTransform: 'uppercase', color: '#9CA3AF' }}>{label}</p>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const {
    saleOrders, invoices, products, repairs, purchaseOrders,
    warranties, posOrders, contacts, setModule, deliveries,
    employees, leaveRequests, payrollRuns, users,
    expenses, outsourceJobs, refurbishmentJobs,
    currentUserId, profileImages,
  } = useApp()

  const currentUser = users.find(u => u.id === currentUserId) ?? null
  const role        = currentUser?.role ?? 'sales_rep'
  const myModules   = new Set(currentUser?.modules ?? [])
  const has         = (m: ModuleId) => myModules.has(m)

  const isAdmin   = role === 'admin'
  const isFinance = role === 'finance'
  const isSales   = role === 'sales_rep'
  const isLead    = role === 'lead_tech'
  const isTech    = role === 'repair_tech'

  const avatar   = currentUserId ? (profileImages[currentUserId] ?? null) : null
  const initials = (currentUser?.name ?? '??').slice(0, 2).toUpperCase()

  // ── Filtered data by role ──────────────────────────────────────────────────
  const myRepairs    = isTech
    ? repairs.filter(r => r.assignedTechnicianId === currentUserId)
    : repairs
  const activeRepairs = myRepairs.filter(r => !['closed','cancelled','delivered','invoiced'].includes(r.status))

  const myExpenses = expenses.filter(e => e.submittedByUserId === currentUserId)

  const myEmployee    = employees.find(e => e.userId === currentUserId)
  const myLeaves      = leaveRequests.filter(r => r.employeeId === myEmployee?.id)
  const pendingLeave  = isAdmin ? leaveRequests.filter(r => r.status === 'pending_hr').length
                                : myLeaves.filter(r => r.status === 'pending_hr').length

  // ── Financial KPIs ─────────────────────────────────────────────────────────
  const revenue       = invoices.filter(i => i.type === 'customer_invoice' && i.status === 'paid').reduce((a,i) => a + i.total, 0)
  const outstanding   = invoices.filter(i => i.type === 'customer_invoice' && (i.status === 'posted' || i.status === 'overdue')).reduce((a,i) => a + (i.total - i.amountPaid), 0)
  const payables      = invoices.filter(i => i.type === 'vendor_bill'      && (i.status === 'posted' || i.status === 'overdue')).reduce((a,i) => a + (i.total - i.amountPaid), 0)
  const stockValue    = products.reduce((a,p) => a + p.costPrice * p.stockQty, 0)

  // ── Operational KPIs ───────────────────────────────────────────────────────
  const openRepairs   = activeRepairs.length
  const lowStock      = products.filter(p => p.stockQty <= p.minStock && p.minStock > 0 && p.unit !== 'service').length
  const pendingQuotes = saleOrders.filter(s => s.status === 'quotation').length
  const activeWarranties   = warranties.filter(w => w.status === 'active').length
  const expiringWarranties = warranties.filter(w => w.status === 'expiring').length
  const posToday      = posOrders.reduce((a,o) => a + o.total, 0)
  const activeEmployees = employees.filter(e => e.status === 'active').length

  // ── Charts data ────────────────────────────────────────────────────────────
  const weeks = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
  const trendData = weeks.map((day, i) => ({
    day,
    sales:     [840000,1200000,680000,1540000,920000,2100000,1380000][i],
    purchases: [420000,0,760000,0,440000,0,220000][i],
  }))

  const categoryData = ALL_CATEGORIES
    .map(cat => ({
      name: cat.length > 14 ? cat.slice(0,13)+'…' : cat,
      full: cat,
      count: products.filter(p => p.category === cat && p.isActive).length,
      value: products.filter(p => p.category === cat && p.isActive).reduce((a,p) => a + p.costPrice * p.stockQty, 0),
      stock: products.filter(p => p.category === cat && p.isActive).reduce((a,p) => a + p.stockQty, 0),
      color: CATEGORY_COLORS[cat] ?? '#6B7280',
    }))
    .filter(d => d.count > 0)

  const stockHealthData = ALL_CATEGORIES.map(cat => {
    const catProds = products.filter(p => p.category === cat && p.isActive && p.unit !== 'service')
    return {
      name: cat.length > 10 ? cat.slice(0,9)+'…' : cat,
      onHand:  catProds.reduce((a,p) => a + p.stockQty, 0),
      reorder: catProds.reduce((a,p) => a + p.minStock, 0),
      color: CATEGORY_COLORS[cat] ?? '#6B7280',
    }
  }).filter(d => d.onHand > 0 || d.reorder > 0)

  const pipeline = [
    { stage: 'Quotation', count: saleOrders.filter(s=>s.status==='quotation').length,  value: saleOrders.filter(s=>s.status==='quotation').reduce((a,s)=>a+s.total,0),  color: '#F59E0B' },
    { stage: 'Confirmed', count: saleOrders.filter(s=>s.status==='confirmed').length,  value: saleOrders.filter(s=>s.status==='confirmed').reduce((a,s)=>a+s.total,0),  color: '#3B82F6' },
    { stage: 'Delivered', count: saleOrders.filter(s=>s.status==='delivered').length,  value: saleOrders.filter(s=>s.status==='delivered').reduce((a,s)=>a+s.total,0),  color: '#8B5CF6' },
    { stage: 'Invoiced',  count: saleOrders.filter(s=>s.status==='invoiced').length,   value: saleOrders.filter(s=>s.status==='invoiced').reduce((a,s)=>a+s.total,0),   color: '#10B981' },
  ]
  const maxPipelineValue = Math.max(...pipeline.map(s => s.value), 1)

  // ── Action items ───────────────────────────────────────────────────────────
  const urgentRepairs  = activeRepairs.filter(r => r.status === 'diagnosed' || r.status === 'approved')
  const unassignedRep  = repairs.filter(r => r.status === 'received' && !r.assignedTechnicianId)
  const overdueInv     = invoices.filter(i => i.status === 'overdue')
  const pendingBills   = invoices.filter(i => i.type === 'vendor_bill' && i.status === 'posted')
  const refurbQueued   = refurbishmentJobs.filter(j => isTech
    ? j.assignedTechnicianId === currentUserId && j.status !== 'transferred'
    : j.status === 'queued')

  // ── Recent activity ────────────────────────────────────────────────────────
  type ActivityItem = { icon: string; title: string; sub: string; time: string; color: string }
  const activity: ActivityItem[] = [
    ...(has('sales')     ? saleOrders.slice(0,2).map(so => ({ icon:'💼', title:`${so.ref} — ${so.customerName}`, sub:`${fmtKes(so.total)} · ${so.status}`, time:fmtDate(so.date), color:'#8B5CF6' })) : []),
    ...(has('accounting')? invoices.filter(i=>i.type==='customer_invoice').slice(0,2).map(i=>({ icon:'🧾', title:`${i.ref} — ${i.partnerName}`, sub:`${fmtKes(i.total)} · ${i.status}`, time:fmtDate(i.date), color:'#10B981' })) : []),
    ...(has('repair')    ? myRepairs.slice(0,3).map(r=>({ icon:'🔧', title:`${r.ref} — ${r.productName}`, sub:`${r.customerName} · ${r.status.replace(/_/g,' ')}`, time:fmtDate(r.date), color:'#EF4444' })) : []),
    ...(has('purchase')  ? purchaseOrders.slice(0,1).map(po=>({ icon:'🛒', title:`${po.ref} — ${po.vendorName}`, sub:`${fmtKes(po.total)} · ${po.status}`, time:fmtDate(po.date), color:'#F79009' })) : []),
    ...(has('pos')       ? posOrders.slice(0,1).map(p=>({ icon:'🖥️', title:`POS — ${p.ref}`, sub:`${fmtKes(p.total)} · ${p.payment}`, time:fmtDate(p.date), color:'#EC4899' })) : []),
  ].slice(0, 8)

  // ── Welcome message ────────────────────────────────────────────────────────
  const welcomeSub = isAdmin   ? `Full system access · ${employees.length} employees · ${repairs.filter(r=>!['closed','cancelled'].includes(r.status)).length} active repairs`
                   : isFinance ? `Finance view · ${overdueInv.length} overdue invoice${overdueInv.length !== 1 ? 's' : ''} · ${pendingBills.length} pending bill${pendingBills.length !== 1 ? 's' : ''}`
                   : isLead    ? `Lead Technician · ${unassignedRep.length} unassigned repair${unassignedRep.length !== 1 ? 's' : ''} · ${activeRepairs.length} active jobs`
                   : isTech    ? `Repair Technician · ${activeRepairs.length} job${activeRepairs.length !== 1 ? 's' : ''} assigned to you`
                   : isSales   ? `Sales · ${pendingQuotes} open quote${pendingQuotes !== 1 ? 's' : ''} · ${contacts.length} contacts`
                   : `${myModules.size} module${myModules.size !== 1 ? 's' : ''} accessible`

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const repairStatusColor = (s: string) => ({
    received: '#F59E0B', assigned: '#3B82F6', diagnosed: '#8B5CF6',
    in_progress: '#F97316', ready: '#10B981', closed: '#9CA3AF',
  }[s] ?? '#9CA3AF')

  return (
    <div className="flex flex-col gap-4 p-1">

      {/* ── Welcome banner ──────────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, #1B2762 0%, #0F1B4D 100%)',
        borderRadius: 16,
        padding: '20px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        boxShadow: '0 8px 32px rgba(27,39,98,0.22)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* decorative blobs */}
        <div style={{ position:'absolute', top:-28, right:-28, width:130, height:130, borderRadius:'50%', background:'rgba(0,176,215,0.10)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', bottom:-24, right:80, width:90, height:90, borderRadius:'50%', background:'rgba(0,176,215,0.07)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', top:'50%', right:'30%', transform:'translateY(-50%)', width:1, height:'70%', background:'rgba(255,255,255,0.04)', pointerEvents:'none' }} />

        {/* Avatar */}
        <div style={{ width:50, height:50, borderRadius:'50%', flexShrink:0, background:avatar?'transparent':'linear-gradient(135deg,#00B0D7,#38BDF8)', overflow:'hidden', border:'2.5px solid rgba(0,176,215,0.55)', display:'flex', alignItems:'center', justifyContent:'center', position:'relative', zIndex:1 }}>
          {avatar
            ? <img src={avatar} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
            : <span style={{ color:'#fff', fontWeight:700, fontSize:17 }}>{initials}</span>}
        </div>

        <div className="flex-1 min-w-0" style={{ position:'relative', zIndex:1 }}>
          <p style={{ fontSize:15, fontWeight:700, color:'#fff', marginBottom:4 }}>
            {greeting}, {currentUser?.name?.split(' ')[0] ?? 'there'} 👋
          </p>
          <p style={{ fontSize:11, color:'rgba(255,255,255,0.60)', lineHeight:1.4 }}>{welcomeSub}</p>
        </div>

        <div className="hidden sm:flex items-center gap-2.5 flex-shrink-0" style={{ position:'relative', zIndex:1 }}>
          <span style={{ fontSize:10, fontWeight:600, padding:'4px 12px', borderRadius:20, background:'rgba(255,255,255,0.12)', color:'rgba(255,255,255,0.92)', border:'1px solid rgba(255,255,255,0.16)' }}>
            {formatRoleLabel(role)}
          </span>
          <span style={{ fontSize:10, color:'rgba(255,255,255,0.42)' }}>
            {new Date().toLocaleDateString('en-KE', { weekday:'short', day:'numeric', month:'short' })}
          </span>
        </div>
      </div>

      {/* ── Financial KPIs ──────────────────────────────────────────────────── */}
      {has('accounting') && (
        <>
          <SectionLabel label="Financial Overview" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Revenue Collected" value={fmtKes(revenue)}     sub="from paid invoices"    color="#10B981" icon={<Fa icon={faMoneyBillWave} />} onClick={() => setModule('accounting')} />
            <KpiCard label="Outstanding"       value={fmtKes(outstanding)} sub="receivables due"        color="#F59E0B" icon={<Fa icon={faArrowDown} />}    onClick={() => setModule('accounting')} />
            <KpiCard label="Payables"          value={fmtKes(payables)}    sub="to vendors"             color="#EF4444" icon={<Fa icon={faArrowUp} />}      onClick={() => setModule('accounting')} />
            <KpiCard label="Pending Bills"     value={pendingBills.length} sub={overdueInv.length > 0 ? `${overdueInv.length} overdue!` : 'all current'} color={overdueInv.length > 0 ? '#EF4444' : '#1B2762'} icon={<Fa icon={faFileInvoiceDollar} />} onClick={() => setModule('accounting')} />
          </div>
        </>
      )}

      {/* ── Operational KPIs ────────────────────────────────────────────────── */}
      {(() => {
        const kpis: React.ReactNode[] = []
        if (has('inventory')) kpis.push(<KpiCard key="stock"    label="Stock Value"    value={fmtKes(stockValue)}    sub="cost basis on hand"                        color="#1B2762" icon={<Fa icon={faBoxesStacked} />}         onClick={() => setModule('inventory')} />)
        if (has('sales'))     kpis.push(<KpiCard key="quotes"   label="Open Quotes"    value={pendingQuotes}         sub="need follow-up"                             color="#3B82F6" icon={<Fa icon={faClipboardList} />}         onClick={() => setModule('sales')} />)
        if (has('repair'))    kpis.push(<KpiCard key="repairs"  label={isTech?'My Active Jobs':'Open Repairs'} value={openRepairs} sub={isTech?'assigned to you':'active jobs'} color="#F97316" icon={<Fa icon={faScrewdriverWrench} />} onClick={() => setModule('repair')} />)
        if (has('inventory')) kpis.push(<KpiCard key="lowstock" label="Low Stock"      value={lowStock}              sub="below min level"                            color="#F59E0B" icon={<Fa icon={faTriangleExclamation} />}   onClick={() => setModule('inventory')} />)
        if (has('repair') || has('sales')) kpis.push(<KpiCard key="war" label="Warranties" value={activeWarranties} sub={`${expiringWarranties} expiring`}           color="#8B5CF6" icon={<Fa icon={faShieldHalved} />} />)
        if (has('pos'))       kpis.push(<KpiCard key="pos"      label="POS Today"      value={posOrders.length}      sub={fmtKes(posToday)}                           color="#EC4899" icon={<Fa icon={faDesktop} />}              onClick={() => setModule('pos')} />)
        if (has('hr'))        kpis.push(<KpiCard key="emp"      label={isAdmin?'Employees':'Leave Balance'} value={isAdmin?activeEmployees:myLeaves.filter(r=>r.status==='approved').length} sub={isAdmin?`${pendingLeave} leave pending`:`${pendingLeave} pending approval`} color="#0891B2" icon={<Fa icon={faUsers} />} onClick={() => setModule('hr')} />)
        if (has('expenses'))  kpis.push(<KpiCard key="exp"      label={isAdmin?'Pending Claims':'My Claims'} value={isAdmin?expenses.filter(e=>e.status==='submitted').length:myExpenses.length} sub={isAdmin?'awaiting review':`${myExpenses.filter(e=>e.status==='approved').length} approved`} color="#059669" icon={<Fa icon={faMoneyCheckDollar} />} onClick={() => setModule('expenses')} />)
        if (has('outsource')) kpis.push(<KpiCard key="out"      label="Outsource Jobs" value={outsourceJobs.filter(j=>j.status==='sent').length} sub="with vendors"  color="#D97706" icon={<Fa icon={faArrowsRotate} />}        onClick={() => setModule('outsource')} />)
        if (has('purchase') && (isAdmin||isFinance)) kpis.push(<KpiCard key="po" label="Open POs" value={purchaseOrders.filter(p=>p.status!=='received'&&p.status!=='cancelled').length} sub="pending receipt/bill" color="#00B0D7" icon={<Fa icon={faCartShopping} />} onClick={() => setModule('purchase')} />)
        if (kpis.length === 0) return null
        return (
          <>
            <SectionLabel label="Operations at a Glance" />
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(175px, 1fr))', gap:12 }}>{kpis}</div>
          </>
        )
      })()}

      {/* ── Repair work queue ───────────────────────────────────────────────── */}
      {(isTech || isLead) && has('repair') && (
        <>
          <SectionLabel label={isTech ? 'My Jobs' : 'Repair Queue'} />
          <div className="card overflow-hidden">
            <CardHeader
              title={isTech ? 'My Repair Jobs' : 'Repair Queue'}
              sub={isTech ? `${activeRepairs.length} active job${activeRepairs.length !== 1 ? 's' : ''} assigned to you` : `${unassignedRep.length} unassigned · ${activeRepairs.length} active`}
              action={<button style={{ background:'none', border:'none', color:'#1B2762', fontWeight:700, fontSize:11, cursor:'pointer' }} onClick={() => setModule('repair')}>View all →</button>}
            />
            {activeRepairs.length === 0 ? (
              <div className="py-10 flex flex-col items-center gap-2">
                <span style={{ fontSize:28 }}>🎉</span>
                <p style={{ fontSize:12, color:'#9CA3AF' }}>No active repair jobs right now</p>
              </div>
            ) : (
              <div style={{ overflowX:'auto' }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1.5fr 1.2fr 0.9fr 0.8fr', minWidth:520, padding:'8px 20px', gap:12, background:'#F9FAFB', borderBottom:'1px solid #F3F4F6' }}>
                  {['REF','DEVICE / CUSTOMER','ISSUE','STATUS','DATE'].map(h => (
                    <span key={h} style={{ fontSize:9, fontWeight:700, letterSpacing:'0.8px', color:'#9CA3AF', textTransform:'uppercase' }}>{h}</span>
                  ))}
                </div>
                {activeRepairs.slice(0, 8).map((r, idx) => (
                  <div key={r.id} style={{ display:'grid', gridTemplateColumns:'1fr 1.5fr 1.2fr 0.9fr 0.8fr', minWidth:520, padding:'11px 20px', gap:12, alignItems:'center', borderBottom:'1px solid #F9FAFB', background: idx % 2 === 0 ? '#fff' : '#FAFAFA', transition:'background 0.1s' }}
                    onMouseOver={e => (e.currentTarget as HTMLElement).style.background = '#F0F4FF'}
                    onMouseOut={e  => (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? '#fff' : '#FAFAFA'}
                  >
                    <span style={{ fontFamily:'monospace', fontSize:11, color:'#1B2762', fontWeight:700 }}>{r.ref}</span>
                    <span>
                      <p style={{ fontSize:12, fontWeight:600, color:'#111827' }}>{r.productName}</p>
                      <p style={{ fontSize:10, color:'#9CA3AF', marginTop:1 }}>{r.customerName}</p>
                    </span>
                    <span style={{ fontSize:11, color:'#6B7280' }} className="truncate">{r.issueDescription ?? '—'}</span>
                    <span>
                      <span style={{ fontSize:10, fontWeight:600, padding:'3px 9px', borderRadius:20, background:repairStatusColor(r.status)+'16', color:repairStatusColor(r.status), border:`1px solid ${repairStatusColor(r.status)}30` }}>
                        {r.status.replace(/_/g,' ')}
                      </span>
                    </span>
                    <span style={{ fontSize:11, color:'#9CA3AF' }}>{fmtDate(r.date)}</span>
                  </div>
                ))}
                {activeRepairs.length > 8 && (
                  <div style={{ padding:'10px 20px', borderTop:'1px solid #F3F4F6', textAlign:'center' }}>
                    <button style={{ background:'none', border:'none', color:'#1B2762', cursor:'pointer', fontSize:11, fontWeight:600 }} onClick={() => setModule('repair')}>
                      +{activeRepairs.length - 8} more — view all in Repairs
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Unassigned repairs alert ─────────────────────────────────────────── */}
      {isLead && unassignedRep.length > 0 && (
        <div style={{ background:'linear-gradient(135deg, #FFFBEB, #FEF3C7)', border:'1px solid #FDE68A', borderRadius:14, padding:'14px 18px', display:'flex', alignItems:'flex-start', gap:12, boxShadow:'0 2px 10px rgba(245,158,11,0.10)' }}>
          <div style={{ width:36, height:36, borderRadius:10, background:'#FDE68A', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>⚠️</div>
          <div style={{ flex:1 }}>
            <p style={{ fontSize:12, fontWeight:700, color:'#92400E', marginBottom:2 }}>
              {unassignedRep.length} repair{unassignedRep.length !== 1 ? 's' : ''} waiting for technician assignment
            </p>
            <p style={{ fontSize:11, color:'#A16207' }}>
              {unassignedRep.slice(0, 3).map(r => r.productName).join(', ')}{unassignedRep.length > 3 ? ` +${unassignedRep.length - 3} more` : ''}
            </p>
          </div>
          <button style={{ background:'#1B2762', border:'none', borderRadius:8, color:'#fff', cursor:'pointer', fontSize:11, fontWeight:600, padding:'6px 14px', flexShrink:0 }} onClick={() => setModule('repair')}>
            Assign now →
          </button>
        </div>
      )}

      {/* ── Open quotations (sales rep) ──────────────────────────────────────── */}
      {isSales && has('sales') && pendingQuotes > 0 && (
        <div className="card overflow-hidden">
          <CardHeader
            title="My Open Quotations"
            sub={`${pendingQuotes} quote${pendingQuotes !== 1 ? 's' : ''} awaiting customer response`}
            action={<button style={{ background:'none', border:'none', color:'#1B2762', fontWeight:700, fontSize:11, cursor:'pointer' }} onClick={() => setModule('sales')}>Open Sales →</button>}
          />
          <div>
            {saleOrders.filter(s=>s.status==='quotation').slice(0, 6).map((so, idx) => (
              <div key={so.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'11px 20px', borderBottom:'1px solid #F9FAFB', background: idx % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                <div className="flex items-center gap-3">
                  <div style={{ width:6, height:6, borderRadius:'50%', background:'#F59E0B', flexShrink:0 }} />
                  <div>
                    <span style={{ fontFamily:'monospace', color:'#1B2762', fontWeight:700, fontSize:12 }}>{so.ref}</span>
                    <span style={{ color:'#6B7280', marginLeft:8, fontSize:11 }}>{so.customerName}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span style={{ fontFamily:'monospace', fontWeight:700, color:'#111827', fontSize:12 }}>{fmtKes(so.total)}</span>
                  <span style={{ fontSize:10, color:'#9CA3AF' }}>{fmtDate(so.date)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Overdue invoices (finance) ───────────────────────────────────────── */}
      {isFinance && overdueInv.length > 0 && (
        <div className="card overflow-hidden">
          <CardHeader
            title="Overdue Invoices"
            sub={`${overdueInv.length} invoice${overdueInv.length !== 1 ? 's' : ''} past due date`}
            action={<button style={{ background:'none', border:'none', color:'#EF4444', fontWeight:700, fontSize:11, cursor:'pointer' }} onClick={() => setModule('accounting')}>View all →</button>}
          />
          <div>
            {overdueInv.slice(0, 5).map((inv, idx) => (
              <div key={inv.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'11px 20px', borderBottom:'1px solid #F9FAFB', background: idx % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                <div className="flex items-center gap-3">
                  <div style={{ width:6, height:6, borderRadius:'50%', background:'#EF4444', flexShrink:0 }} />
                  <div>
                    <span style={{ fontFamily:'monospace', color:'#EF4444', fontWeight:700, fontSize:12 }}>{inv.ref}</span>
                    <span style={{ color:'#6B7280', marginLeft:8, fontSize:11 }}>{inv.partnerName}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span style={{ fontFamily:'monospace', fontWeight:700, color:'#EF4444', fontSize:12 }}>{fmtKes(inv.total - inv.amountPaid)}</span>
                  <span style={{ fontSize:10, color:'#9CA3AF' }}>Due {fmtDate(inv.dueDate)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Charts row ──────────────────────────────────────────────────────── */}
      {(has('accounting') || has('sales')) && (
        <>
          <SectionLabel label="Trends & Analytics" />
          <div className={`grid grid-cols-1 gap-3 ${(has('inventory') || has('sales') && !isTech) ? 'lg:grid-cols-5' : ''}`}>
            {/* Revenue / Purchases trend */}
            <div className={`card overflow-hidden ${(has('inventory') || has('sales')) ? 'lg:col-span-3' : ''}`}>
              <CardHeader
                title={has('accounting') ? 'Revenue vs Purchases' : 'Sales Trend'}
                sub="Weekly performance"
                action={
                  <div className="flex items-center gap-4" style={{ fontSize:10, color:'#9CA3AF' }}>
                    <span className="flex items-center gap-1.5"><span style={{ width:8, height:8, borderRadius:'50%', background:'#1B2762', display:'inline-block' }} />Sales</span>
                    {has('purchase') && <span className="flex items-center gap-1.5"><span style={{ width:8, height:8, borderRadius:'50%', background:'#EF4444', display:'inline-block' }} />Purchases</span>}
                  </div>
                }
              />
              <div className="p-4" style={{ height:180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData} margin={{ top:4, right:4, left:0, bottom:0 }}>
                    <defs>
                      <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#1B2762" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="#1B2762" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gPurch" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#EF4444" stopOpacity={0.12} />
                        <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="day" tick={{ fill:'#9CA3AF', fontSize:10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill:'#9CA3AF', fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v => v>=1000000?`${(v/1000000).toFixed(1)}M`:`${(v/1000).toFixed(0)}K`} width={42} />
                    <Tooltip contentStyle={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, fontSize:11, boxShadow:'0 4px 14px rgba(0,0,0,0.08)' }} labelStyle={{ color:'#111827', fontWeight:700 }} formatter={(v:number,n:string) => [fmtKes(v), n==='sales'?'Sales':'Purchases']} />
                    <Area type="monotone" dataKey="sales" stroke="#1B2762" strokeWidth={2.5} fill="url(#gSales)" />
                    {has('purchase') && <Area type="monotone" dataKey="purchases" stroke="#EF4444" strokeWidth={1.5} fill="url(#gPurch)" />}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Inventory donut */}
            {has('inventory') && (
              <div className="card overflow-hidden lg:col-span-2">
                <CardHeader title="Inventory by Category" sub={`${products.filter(p=>p.isActive).length} products · ${fmtKes(stockValue)}`} />
                <div style={{ height:180 }} className="p-2">
                  {categoryData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={categoryData} dataKey="count" nameKey="name" cx="42%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={3}>
                          {categoryData.map((e,i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" iconSize={7} formatter={v => <span style={{ fontSize:10, color:'#374151' }}>{v}</span>} />
                        <Tooltip contentStyle={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, fontSize:11, boxShadow:'0 4px 14px rgba(0,0,0,0.08)' }} formatter={(v:number,_n:string,props:{payload?:{full?:string;stock?:number}}) => [`${v} products · ${props.payload?.stock??0} units`, props.payload?.full??'']} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full" style={{ color:'#9CA3AF', fontSize:12 }}>No products yet</div>
                  )}
                </div>
              </div>
            )}

            {/* Pipeline (when no inventory) */}
            {has('sales') && !has('inventory') && (
              <div className="card overflow-hidden lg:col-span-2">
                <CardHeader title="Sales Pipeline" sub={`${saleOrders.length} total orders`} />
                <div className="p-5 flex flex-col gap-4">
                  {pipeline.map(s => (
                    <div key={s.stage}>
                      <div className="flex justify-between mb-1.5" style={{ fontSize:11 }}>
                        <span style={{ color:'#374151', fontWeight:600 }}>{s.stage}</span>
                        <div className="flex gap-4">
                          <span style={{ color:'#9CA3AF' }}>{s.count} orders</span>
                          <span style={{ fontWeight:700, color:s.color }}>{fmtKes(s.value)}</span>
                        </div>
                      </div>
                      <div style={{ height:5, background:'#F3F4F6', borderRadius:3, overflow:'hidden' }}>
                        <div style={{ height:'100%', width:`${Math.min(100,(s.value/maxPipelineValue)*100)}%`, background:s.color, borderRadius:3, transition:'width 0.4s' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Stock health + pipeline ───────────────────────────────────────────── */}
      {has('inventory') && has('sales') && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
          <div className="card overflow-hidden lg:col-span-3">
            <CardHeader
              title="Stock On-Hand vs Reorder Level"
              sub="By category (units)"
              action={
                <div className="flex items-center gap-4" style={{ fontSize:10, color:'#9CA3AF' }}>
                  <span className="flex items-center gap-1.5"><span style={{ width:8, height:8, borderRadius:2, background:'#1B2762', display:'inline-block' }} />On Hand</span>
                  <span className="flex items-center gap-1.5"><span style={{ width:8, height:8, borderRadius:2, background:'#FCA5A5', display:'inline-block' }} />Reorder</span>
                </div>
              }
            />
            <div className="p-4" style={{ height:170 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stockHealthData} barGap={2} margin={{ top:4, right:4, left:0, bottom:0 }}>
                  <XAxis dataKey="name" tick={{ fill:'#9CA3AF', fontSize:9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill:'#9CA3AF', fontSize:9 }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip contentStyle={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:10, fontSize:11, boxShadow:'0 4px 14px rgba(0,0,0,0.08)' }} labelStyle={{ color:'#111827', fontWeight:700 }} />
                  <Bar dataKey="onHand" name="On Hand" radius={[4,4,0,0]}>{stockHealthData.map((e,i) => <Cell key={i} fill={e.color} />)}</Bar>
                  <Bar dataKey="reorder" name="Reorder Level" radius={[4,4,0,0]} fill="#FCA5A5" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card overflow-hidden lg:col-span-2">
            <CardHeader title="Sales Pipeline" sub={`${saleOrders.length} total orders`} />
            <div className="p-5 flex flex-col gap-4">
              {pipeline.map(s => (
                <div key={s.stage}>
                  <div className="flex justify-between mb-1.5" style={{ fontSize:11 }}>
                    <span style={{ color:'#374151', fontWeight:600 }}>{s.stage}</span>
                    <div className="flex gap-4">
                      <span style={{ color:'#9CA3AF' }}>{s.count} orders</span>
                      <span style={{ fontWeight:700, color:s.color }}>{fmtKes(s.value)}</span>
                    </div>
                  </div>
                  <div style={{ height:5, background:'#F3F4F6', borderRadius:3, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${Math.min(100,(s.value/maxPipelineValue)*100)}%`, background:s.color, borderRadius:3, transition:'width 0.4s' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Activity + Alerts row ────────────────────────────────────────────── */}
      {(activity.length > 0 || has('inventory')) && (
        <>
          <SectionLabel label="Activity & Alerts" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {activity.length > 0 && (
              <div className="card overflow-hidden">
                <CardHeader title="Recent Activity" />
                <div>
                  {activity.map((a, i) => (
                    <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'12px 20px', borderBottom:'1px solid #F9FAFB' }}>
                      <div style={{ width:34, height:34, borderRadius:10, background:a.color+'14', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, flexShrink:0 }}>
                        {a.icon}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <p style={{ fontSize:12, fontWeight:500, color:'#111827', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.title}</p>
                        <p style={{ fontSize:10, color:'#9CA3AF', marginTop:2 }}>{a.sub}</p>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, flexShrink:0 }}>
                        <span style={{ fontSize:10, color:'#9CA3AF' }}>{a.time}</span>
                        <span style={{ width:6, height:6, borderRadius:'50%', background:a.color, display:'inline-block' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3">
              {/* Stock alerts */}
              {has('inventory') && (
                <div className="card overflow-hidden flex-1">
                  <CardHeader
                    title="Stock Alerts"
                    action={<button style={{ background:'none', border:'none', color:'#1B2762', fontWeight:700, fontSize:11, cursor:'pointer' }} onClick={() => setModule('inventory')}>View all →</button>}
                  />
                  {products.filter(p=>p.stockQty<=p.minStock&&p.minStock>0&&p.unit!=='service').slice(0, 4).map((p, idx) => {
                    const isOut = p.stockQty === 0
                    return (
                      <div key={p.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 20px', borderBottom:'1px solid #F9FAFB', background: isOut ? '#FFF5F5' : '#FFFBF0' }}>
                        <div className="flex items-center gap-3">
                          <span style={{ fontSize:18 }}>{p.image}</span>
                          <div>
                            <p style={{ fontSize:12, fontWeight:500, color:'#111827', maxWidth:150, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.name}</p>
                            <p style={{ fontSize:10, color:'#9CA3AF' }}>{p.category}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span style={{ fontFamily:'monospace', fontSize:10, color:'#6B7280' }}>{p.stockQty}/{p.minStock}</span>
                          <span style={{ fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:20, background: isOut ? '#FEE2E2' : '#FEF3C7', color: isOut ? '#DC2626' : '#92400E', border: `1px solid ${isOut ? '#FECACA' : '#FDE68A'}` }}>
                            {isOut ? 'OUT' : 'LOW'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                  {products.filter(p=>p.stockQty<=p.minStock&&p.minStock>0&&p.unit!=='service').length===0 && (
                    <div className="py-6 flex flex-col items-center gap-1">
                      <span style={{ fontSize:22 }}>✅</span>
                      <p style={{ fontSize:11, color:'#9CA3AF' }}>All stock levels healthy</p>
                    </div>
                  )}
                </div>
              )}

              {/* HR snapshot */}
              {has('hr') && (
                <div className="card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <p style={{ fontSize:12, fontWeight:700, color:'#111827' }}>{isAdmin ? 'HR Snapshot' : 'My Leave'}</p>
                    <button style={{ background:'none', border:'none', color:'#1B2762', fontWeight:700, fontSize:11, cursor:'pointer' }} onClick={() => setModule('hr')}>View HR →</button>
                  </div>
                  {isAdmin ? (
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label:'Employees',     value:activeEmployees,                   color:'#0891B2', icon:'👥' },
                        { label:'Leave Pending', value:pendingLeave,                      color:'#F59E0B', icon:'🌴' },
                        { label:'Active Users',  value:users.filter(u=>u.active).length, color:'#10B981', icon:'🔑' },
                      ].map(stat => (
                        <div key={stat.label} style={{ borderRadius:12, padding:'12px 8px', textAlign:'center', background:stat.color+'12', border:`1px solid ${stat.color}22` }}>
                          <p style={{ fontSize:18, marginBottom:4 }}>{stat.icon}</p>
                          <p style={{ fontSize:20, fontWeight:800, color:stat.color, lineHeight:1 }}>{stat.value}</p>
                          <p style={{ fontSize:9, color:'#9CA3AF', marginTop:4, letterSpacing:'0.5px' }}>{stat.label}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {myLeaves.slice(0, 3).map(l => (
                        <div key={l.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', paddingBottom:8, borderBottom:'1px solid #F3F4F6' }}>
                          <span style={{ fontSize:12, textTransform:'capitalize', color:'#374151', fontWeight:500 }}>{l.leaveType.replace(/_/g,' ')}</span>
                          <div className="flex items-center gap-2">
                            <span style={{ fontSize:10, color:'#9CA3AF' }}>{l.days}d</span>
                            <Badge status={l.status==='approved'?'active':l.status==='rejected'?'cancelled':'pending'} label={l.status.replace('_',' ')} />
                          </div>
                        </div>
                      ))}
                      {myLeaves.length === 0 && <p style={{ fontSize:12, color:'#9CA3AF' }}>No leave requests yet</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Inventory value breakdown ────────────────────────────────────────── */}
      {has('inventory') && (
        <>
          <SectionLabel label="Inventory Value" />
          <div className="card overflow-hidden">
            <CardHeader title="Value Breakdown by Category" sub="Cost-basis stock value across all locations" />
            <div className="p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {ALL_CATEGORIES.map(cat => {
                const prods = products.filter(p => p.category === cat && p.isActive)
                const val   = prods.reduce((a,p) => a + p.costPrice * p.stockQty, 0)
                const qty   = prods.reduce((a,p) => a + p.stockQty, 0)
                const color = CATEGORY_COLORS[cat] ?? '#6B7280'
                return (
                  <div key={cat} style={{ borderRadius:12, padding:'14px 12px', background:`${color}08`, border:`1px solid ${color}22`, display:'flex', flexDirection:'column', gap:4 }}>
                    <p style={{ fontSize:9, textTransform:'uppercase', letterSpacing:'0.7px', fontWeight:700, color }}>{cat.length>12?cat.slice(0,11)+'…':cat}</p>
                    <p style={{ fontSize:14, fontWeight:800, color:'#111827' }}>{fmtKes(val)}</p>
                    <p style={{ fontSize:9, color:'#9CA3AF' }}>{prods.length} products · {qty} units</p>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* ── Business flow (admin) ────────────────────────────────────────────── */}
      {isAdmin && (
        <>
          <SectionLabel label="Business Flow" />
          <div className="card overflow-hidden">
            <CardHeader title="End-to-End Workflow" />
            <div className="p-4 flex items-center gap-2 overflow-x-auto flex-wrap" style={{ scrollbarWidth:'none' }}>
              {([
                { label:'Contacts',   icon:'👥', mod:'contacts'   as const, color:'#2E90FA' },
                { label:'→' },
                { label:'Quotation',  icon:'📋', mod:'sales'      as const, color:'#8B5CF6' },
                { label:'→' },
                { label:'Sale Order', icon:'💼', mod:'sales'      as const, color:'#8B5CF6' },
                { label:'→' },
                { label:'Delivery',   icon:'📦', mod:'inventory'  as const, color:'#F79009' },
                { label:'→' },
                { label:'Warranty',   icon:'🛡️', mod:'repair'     as const, color:'#10B981' },
                { label:'→' },
                { label:'Invoice',    icon:'🧾', mod:'accounting' as const, color:'#10B981' },
                { label:'→' },
                { label:'Payment',    icon:'💰', mod:'accounting' as const, color:'#10B981' },
              ] as {label:string;icon?:string;mod?:string;color?:string}[]).map((step, i) =>
                !step.mod ? (
                  <span key={i} style={{ color:'#D1D5DB', fontWeight:700, fontSize:14, userSelect:'none', flexShrink:0 }}>›</span>
                ) : (
                  <button key={i} onClick={() => setModule(step.mod as Parameters<typeof setModule>[0])}
                    style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:10, fontSize:11, fontWeight:600, cursor:'pointer', flexShrink:0, background:`${step.color}12`, border:`1px solid ${step.color}30`, color:step.color, transition:'all 0.15s' }}
                    onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = step.color + '22' }}
                    onMouseOut={e  => { (e.currentTarget as HTMLElement).style.background = step.color + '12' }}
                  >
                    {step.icon && <span style={{ fontSize:13 }}>{step.icon}</span>}
                    {step.label}
                  </button>
                )
              )}
            </div>
            <div className="px-4 pb-4 flex items-center gap-2 flex-wrap">
              <span style={{ fontSize:9, fontWeight:600, letterSpacing:'0.8px', textTransform:'uppercase', color:'#9CA3AF', flexShrink:0 }}>Parallel:</span>
              {([
                { label:'Purchase → Stock', mod:'purchase' as const, color:'#F79009' },
                { label:'POS → Accounting', mod:'pos'      as const, color:'#EC4899' },
                { label:'Repair → Parts',   mod:'repair'   as const, color:'#EF4444' },
                { label:'HR → Payroll',     mod:'hr'       as const, color:'#0891B2' },
              ] as {label:string;mod:Parameters<typeof setModule>[0];color:string}[]).map(b => (
                <button key={b.label} onClick={() => setModule(b.mod)}
                  style={{ padding:'4px 12px', borderRadius:8, fontSize:10, fontWeight:600, cursor:'pointer', background:`${b.color}10`, border:`1px solid ${b.color}25`, color:b.color, transition:'all 0.15s' }}
                  onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = b.color + '20' }}
                  onMouseOut={e  => { (e.currentTarget as HTMLElement).style.background = b.color + '10' }}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── No access fallback ───────────────────────────────────────────────── */}
      {myModules.size <= 1 && !isAdmin && (
        <div className="card p-10 flex flex-col items-center gap-4 text-center">
          <div style={{ width:56, height:56, borderRadius:'50%', background:'#F3F4F6', display:'flex', alignItems:'center', justifyContent:'center', fontSize:24 }}>🔒</div>
          <div>
            <p style={{ fontSize:14, fontWeight:700, color:'#111827', marginBottom:6 }}>Limited Access</p>
            <p style={{ fontSize:12, color:'#6B7280', maxWidth:320, lineHeight:1.6 }}>
              Your account has access to {myModules.size === 0 ? 'no modules' : 'only the Dashboard'}.
              Ask your administrator to grant you access to additional modules.
            </p>
          </div>
        </div>
      )}

    </div>
  )
}
