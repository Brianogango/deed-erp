'use client'
import { SearchPicker } from '@/components/ui'

type Account = { code: string; name: string }

/**
 * A chart-of-accounts picker you can type into: by code ("6507") or by name
 * ("fuel"). The first entry is the "nothing chosen" option.
 */
export default function AccountSearchSelect({
  accounts, value, onChange, label, noneLabel, placeholder = 'Search account by code or name…', className,
}: {
  accounts: Account[]
  value: string | undefined
  onChange: (code: string) => void
  /** For screen readers; not shown. */
  label: string
  noneLabel: string
  placeholder?: string
  className?: string
}) {
  const current = value ? accounts.find(a => a.code === value) : undefined
  return (
    <div className={className}>
      <SearchPicker
        label={label}
        labelClassName="sr-only"
        placeholder={placeholder}
        items={[
          { id: '__none', code: '', name: noneLabel },
          ...accounts.map(a => ({ id: a.code, code: a.code, name: a.name })),
        ]}
        searchText={item => `${item.code} ${item.name}`}
        renderItem={item => (
          <span className="text-xs">
            {item.code ? <><span className="font-mono">{item.code}</span> — {item.name}</> : <em>{item.name}</em>}
          </span>
        )}
        selectedLabel={current ? `${current.code} — ${current.name}` : value ? value : ''}
        formatSelected={item => (item.code ? `${item.code} — ${item.name}` : '')}
        onSelect={item => onChange(item.code)}
        emptyText="No account matches"
      />
    </div>
  )
}
