'use client'

import { useMemo } from 'react'
import { useApp, fmtKes, fmtDate } from '@/lib/store'
import { Badge, StatCard, PanelHeader, Divider, InfoRow } from '@/components/ui'
import { Fa } from '@/components/icons'
import { 
  faBuilding, 
  faCreditCard, 
  faChartLine, 
  faHistory, 
  faUserTie,
  faEnvelope,
  faPhone,
  faGlobe
} from '@fortawesome/free-solid-svg-icons'

export default function ClientDetail({ clientId, onClose }: { clientId: string, onClose: () => void }) {
  const { companies, saleOrders, opportunities, contactPersons } = useApp()

  const client = useMemo(() => companies.find(c => c.id === clientId), [companies, clientId])

  const clientOrders = useMemo(() =>
    saleOrders.filter(o => o.clientId === clientId).sort((a, b) => b.orderDate.localeCompare(a.orderDate)),
    [saleOrders, clientId]
  )
  
  const clientOpps = useMemo(() => 
    opportunities.filter(o => o.clientId === clientId).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [opportunities, clientId]
  )
  
  const clientContacts = useMemo(() => 
    contactPersons.filter(cp => cp.clientId === clientId),
    [contactPersons, clientId]
  )

  const stats = useMemo(() => {
    const totalRevenue = clientOrders.filter(o => o.status === 'invoiced').reduce((acc, o) => acc + o.totalAmount, 0)
    const openOppsValue = clientOpps.filter(o => !['closed_won', 'closed_lost'].includes(o.stage)).reduce((acc, o) => acc + o.expectedValue, 0)
    const winRate = clientOpps.length > 0
      ? Math.round((clientOpps.filter(o => o.stage === 'closed_won').length / clientOpps.length) * 100)
      : 0
      
    return { totalRevenue, openOppsValue, winRate }
  }, [clientOrders, clientOpps])

  if (!client) return null

  const creditUsagePercent = (client.creditLimit ?? 0) > 0 ? Math.min(100, Math.round((client.creditUsed / (client.creditLimit ?? 1)) * 100)) : 0
  const creditColor = creditUsagePercent > 90 ? 'var(--danger)' : creditUsagePercent > 70 ? 'var(--warning)' : 'var(--success)'

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-4 border-[var(--border-lt)]">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="btn-outline text-xs px-3 py-1.5">← Back</button>
          <div>
            <h2 className="text-xl font-bold text-[var(--text-1)]">{client.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge status={client.status} label={client.status} />
              {client.segment && <span className="badge badge-purple text-[10px]">{client.segment}</span>}
              <span className="text-xs text-[var(--text-3)]">{client.industry || 'General Industry'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard 
          label="Lifetime Value" 
          value={fmtKes(stats.totalRevenue)} 
          sub="Total invoiced revenue"
          color="#10B981"
          icon={<Fa icon={faChartLine} />}
        />
        <StatCard 
          label="Open Pipeline" 
          value={fmtKes(stats.openOppsValue)} 
          sub={`${clientOpps.filter(o => !(['closed_won', 'closed_lost'] as string[]).includes(o.stage)).length} active opportunities`}
          color="#3B82F6"
          icon={<Fa icon={faBuilding} />}
        />
        <StatCard 
          label="Win Rate" 
          value={`${stats.winRate}%`} 
          sub="Historical conversion"
          color="#8B5CF6"
          icon={<Fa icon={faHistory} />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Client Info & Financials */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          <div className="card p-5">
            <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
              <Fa icon={faBuilding} className="text-primary-500" />
              Company Information
            </h3>
            <div className="space-y-1">
              <InfoRow label="Tax ID / PIN" value={client.taxId} mono />
              <InfoRow label="Email" value={<a href={`mailto:${client.email}`} className="text-primary-600 hover:underline">{client.email}</a>} />
              <InfoRow label="Phone" value={client.phone} />
              <InfoRow label="Website" value={client.website ? <a href={client.website} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline flex items-center gap-1"><Fa icon={faGlobe} size="xs" /> Link</a> : '-'} />
              <InfoRow label="City" value={client.city} />
              <InfoRow label="Address" value={client.physicalAddress} />
            </div>
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
              <Fa icon={faCreditCard} className="text-amber-500" />
              Financial Insights
            </h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[var(--text-3)]">Credit Usage</span>
                  <span className="font-bold" style={{ color: creditColor }}>{creditUsagePercent}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full transition-all duration-500" 
                    style={{ width: `${creditUsagePercent}%`, background: creditColor }}
                  />
                </div>
                <div className="flex justify-between text-[10px] mt-1 text-[var(--text-4)]">
                  <span>Used: {fmtKes(client.creditUsed)}</span>
                  <span>Limit: {fmtKes(client.creditLimit ?? 0)}</span>
                </div>
              </div>
              <Divider />
              <InfoRow label="Payment Terms" value={`${client.paymentTerms ?? 30} Days`} />
              <InfoRow label="Total Orders" value={clientOrders.length} />
            </div>
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
              <Fa icon={faUserTie} className="text-blue-500" />
              Contacts ({clientContacts.length})
            </h3>
            <div className="space-y-3">
              {clientContacts.map(contact => (
                <div key={contact.id} className="p-3 rounded-xl border border-[var(--border-lt)] bg-[var(--bg-surface)]">
                  <p className="text-xs font-bold">{contact.firstName} {contact.lastName}</p>
                  <p className="text-[10px] text-[var(--text-3)] mb-2">{contact.jobTitle}</p>
                  <div className="flex items-center gap-3 text-[10px]">
                    <span className="flex items-center gap-1"><Fa icon={faEnvelope} size="xs" /> {contact.email}</span>
                    <span className="flex items-center gap-1"><Fa icon={faPhone} size="xs" /> {contact.phone}</span>
                  </div>
                </div>
              ))}
              {clientContacts.length === 0 && <p className="text-xs text-[var(--text-4)] text-center py-4">No contacts listed</p>}
            </div>
          </div>
        </div>

        {/* Right Column: Pipeline & History */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="card overflow-hidden">
            <PanelHeader title="Active Pipeline" count={clientOpps.filter(o => !(['closed_won', 'closed_lost'] as string[]).includes(o.stage)).length} />
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                    <th className="px-4 py-3 text-[10px] font-bold uppercase text-[var(--text-4)]">Ref</th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase text-[var(--text-4)]">Opportunity</th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase text-[var(--text-4)]">Stage</th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase text-[var(--text-4)] text-right">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-lt)]">
                  {clientOpps.slice(0, 5).map(opp => (
                    <tr key={opp.id} className="hover:bg-[var(--bg-surface)] transition-colors">
                      <td className="px-4 py-3 text-xs font-mono">{opp.ref ?? opp.id.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-xs font-medium">{opp.name}</td>
                      <td className="px-4 py-3"><Badge status={opp.stage} size="xs" /></td>
                      <td className="px-4 py-3 text-xs font-bold text-right">{fmtKes(opp.expectedValue)}</td>
                    </tr>
                  ))}
                  {clientOpps.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-xs text-[var(--text-4)]">No opportunities found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card overflow-hidden">
            <PanelHeader title="Recent Sales History" count={clientOrders.length} />
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-lt)]">
                    <th className="px-4 py-3 text-[10px] font-bold uppercase text-[var(--text-4)]">Ref</th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase text-[var(--text-4)]">Date</th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase text-[var(--text-4)]">Status</th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase text-[var(--text-4)] text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-lt)]">
                  {clientOrders.slice(0, 5).map(order => (
                    <tr key={order.id} className="hover:bg-[var(--bg-surface)] transition-colors">
                      <td className="px-4 py-3 text-xs font-mono">{order.orderNumber}</td>
                      <td className="px-4 py-3 text-xs">{fmtDate(order.orderDate)}</td>
                      <td className="px-4 py-3"><Badge status={order.status} size="xs" /></td>
                      <td className="px-4 py-3 text-xs font-bold text-right">{fmtKes(order.totalAmount)}</td>
                    </tr>
                  ))}
                  {clientOrders.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-xs text-[var(--text-4)]">No sales history found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
