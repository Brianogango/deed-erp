from pathlib import Path

p = Path('components/modules/Inventory.tsx')
s = p.read_text()

state_anchor = "  const [warehouseSearch, setWarehouseSearch] = useUrlUiState('warehouseQ', '')\n  const [warehouseSearchDraft, setWarehouseSearchDraft] = useState(warehouseSearch)\n"
state_replacement = "  const [warehouseSearch, setWarehouseSearch] = useUrlUiState('warehouseQ', '')\n  const [warehouseLocation, setWarehouseLocation] = useUrlUiState('location', 'warehouse')\n  const [warehouseSearchDraft, setWarehouseSearchDraft] = useState(warehouseSearch)\n"
if state_anchor not in s:
    raise SystemExit('warehouse search state anchor not found')
s = s.replace(state_anchor, state_replacement, 1)

old_emphasis = """        const boardEmphasis =
          readyCount > 0 && issuesCount === 0 && refurbCount === 0
            ? 'inventory-warehouse-board inventory-warehouse-board--ready-heavy'
            : 'inventory-warehouse-board'
"""
new_emphasis = """        const activeWarehouseLocation = ['warehouse', 'issues', 'refurbishment'].includes(warehouseLocation)
          ? warehouseLocation as 'warehouse' | 'issues' | 'refurbishment'
          : 'warehouse'
"""
if old_emphasis not in s:
    raise SystemExit('board emphasis anchor not found')
s = s.replace(old_emphasis, new_emphasis, 1)

layout_start_marker = '            <div className="operations-warehouse-layout">\n'
layout_start = s.index(layout_start_marker)
ready_start = s.index('            <Section title="Warehouse — Ready for Sale"', layout_start)
issues_start = s.index('            <Section title="With Issues"', ready_start)
refurb_start = s.index('            <Section title="Refurbishment Unit — Internal Stock"', issues_start)
refurb_end_marker = '            </Section>\n            </div>\n            <aside className="operations-attention"'
refurb_end_pos = s.index(refurb_end_marker, refurb_start)
refurb_end = refurb_end_pos + len('            </Section>\n')

ready_section = s[ready_start:issues_start].strip('\n')
issues_section = s[issues_start:refurb_start].strip('\n')
refurb_section = s[refurb_start:refurb_end].strip('\n')

layout_end_marker = '            </aside>\n            </div>\n          </div>\n        )'
layout_end_pos = s.index(layout_end_marker, refurb_end)
layout_end = layout_end_pos + len('            </aside>\n            </div>\n')

switcher = '''            <div className="rounded-token-md border border-[var(--border-lt)] bg-[var(--bg-card)] overflow-hidden">
              <div className="flex flex-wrap gap-2 border-b border-[var(--border-lt)] bg-[var(--bg-surface)] p-2" role="tablist" aria-label="Inventory stock location">
                {[
                  { id: 'warehouse', label: 'Warehouse', sublabel: 'Ready for Sale', count: readyCount, icon: faIndustry },
                  { id: 'issues', label: 'With Issues', sublabel: 'Needs attention', count: issuesCount, icon: faTriangleExclamation },
                  { id: 'refurbishment', label: 'Refurbishment', sublabel: 'Internal stock', count: refurbCount, icon: faWrench },
                ].map(item => {
                  const selected = activeWarehouseLocation === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setWarehouseLocation(item.id)}
                      className={`min-w-[150px] flex-1 rounded-xl border px-3 py-2.5 text-left transition ${selected
                        ? 'border-[var(--primary)] bg-[var(--primary-light)] text-[var(--navy)] shadow-sm'
                        : 'border-transparent bg-transparent text-text-2 hover:border-[var(--border)] hover:bg-[var(--bg-muted)]'}`}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <Fa icon={item.icon} className="shrink-0 text-[13px]" aria-hidden="true" />
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-bold">{item.label}</span>
                            <span className="block truncate text-[10px] text-text-3">{item.sublabel}</span>
                          </span>
                        </span>
                        <span className="shrink-0 rounded-md bg-white/80 px-2 py-0.5 text-[10px] font-bold tabular-nums text-text-2">{item.count.toLocaleString()}</span>
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="p-3 sm:p-4">
                {activeWarehouseLocation === 'warehouse' && (
                  <div className="inventory-warehouse-board inventory-warehouse-board--single">
__READY__
                  </div>
                )}
                {activeWarehouseLocation === 'issues' && (
                  <div className="inventory-warehouse-board inventory-warehouse-board--single">
__ISSUES__
                  </div>
                )}
                {activeWarehouseLocation === 'refurbishment' && (
                  <div className="inventory-warehouse-board inventory-warehouse-board--single">
__REFURB__
                  </div>
                )}
              </div>
            </div>
'''

def reindent(block: str, spaces: int = 20) -> str:
    pad = ' ' * spaces
    return '\n'.join(pad + line.lstrip() if line.strip() else '' for line in block.splitlines())

switcher = switcher.replace('__READY__', reindent(ready_section))
switcher = switcher.replace('__ISSUES__', reindent(issues_section))
switcher = switcher.replace('__REFURB__', reindent(refurb_section))

s = s[:layout_start] + switcher + s[layout_end:]
p.write_text(s)

Path('scripts/apply_inventory_location_switcher.py').unlink(missing_ok=True)
Path('.github/workflows/apply-inventory-location-switcher.yml').unlink(missing_ok=True)
