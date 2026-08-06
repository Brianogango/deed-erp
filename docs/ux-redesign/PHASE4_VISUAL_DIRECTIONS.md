# Phase 4 — Visual Directions (Sales Operate)

**Date:** 2026-08-06  
**Skills:** frontend-design · design-taste-frontend · MASTER.md  
**Code / production:** unchanged  
**Working comps:** static HTML (not Phase 5 worktrees — `prototype` skill still missing)

| Comp | Path | Screenshot |
|------|------|------------|
| A | `docs/ux-redesign/directions/direction-a-conservative.html` | `/opt/cursor/artifacts/ux-phase4-directions/direction-a-desktop.png` |
| B | `docs/ux-redesign/directions/direction-b-deed-brand.html` | `…/direction-b-desktop.png` |
| C | `docs/ux-redesign/directions/direction-c-premium-minimal.html` | `…/direction-c-desktop.png` |

All three preserve: routes, permissions, DataTable workflow, one pipeline strip, no marketing heroes/glass.

**Taste dials (all):** VARIANCE 2–3 · MOTION 2 · DENSITY 8

---

## Direction A — Conservative enterprise

**Rationale:** Refine the live slate-ink + emerald Sales pilot. Lowest migration risk; fixes Phase 2 issues (dual titles, duplicate KPIs) without rebranding.

| Aspect | Treatment |
|--------|-----------|
| Colour | Ink header `#0F172A`; CTA/active = `--success`; body slate |
| Typography | Inter UI + mono money; title ~20px |
| Layout | Topbar crumb only → ModuleHeader → tabs → **one** rail → toolbar → table |
| Table | Slate header; emerald row hover |
| Forms / detail | Keep StatusStepper; quieter overflow menus (`radius-sm`) |
| Navigation | Sidebar active = primary wash, no glow bloom |
| Status | Emerald pill badges |
| Mobile | Rail → 2×2; header stacks CTA |
| Risks | Less “new brand energy”; still diverges from Inventory navy |

```
[Sidebar][ Topbar: Sales · Quotations & orders ]
         [ Ink header: Sales                    [New quotation] ]
         [ Tabs: Quotations | Orders ]
         [ Rail: Draft | Sent | Confirmed | To invoice ]
         [ Search · Filters ]
         [ Dense table ]
```

---

## Direction B — Modern Deed brand

**Rationale:** Align Sales with Deed navy + cyan (Inventory-adjacent family) so Selling and Supply share one brand language; emerald reserved for money success states only.

| Aspect | Treatment |
|--------|-----------|
| Colour | Full-bleed navy header; cyan CTA + active underline; primary blue for refs |
| Typography | Inter; slightly stronger weight on title |
| Layout | Edge-to-edge command band (not inset card header); single rail as separate cards or inset bar |
| Table | Navy-tint header wash; cyan hover |
| Forms | Cyan focus rings; navy RecordHeader |
| Navigation | Cyan inset active bar on sidebar (shared with Inventory cues) |
| Status | Cyan/info badges for pipeline; success for paid/complete |
| Mobile | Navy header remains; CTA cyan square |
| Risks | Sales loses distinct emerald money cue; must not copy Inventory 1:1; cyan CTA contrast on navy must stay AA |

```
[Sidebar][ Topbar: Selling · Sales ]
[======== Navy command band + cyan CTA ========]
         [ Tabs with cyan underline ]
         [ Rail cells ]
         [ Search · Filters ]
         [ Dense table ]
```

---

## Direction C — Premium minimal

**Rationale:** Precision Swiss/minimal Operate UI — hairline rules, near-flat surfaces, ink CTA, maximum calm. Brand via restraint and typography, not coloured bands.

| Aspect | Treatment |
|--------|-----------|
| Colour | Near-white page; black/ink CTA; success only on status text; borders `#E2E8F0` |
| Typography | Inter with tighter tracking on H1; title names the **active tab** (“Orders”) |
| Layout | No coloured command band; header is type + rule; connected rail as single bordered strip |
| Table | Borderless card — header rule only; hover `#F8FAFC` |
| Forms | 4px radius; quiet fields |
| Navigation | Light sidebar; active = grey wash |
| Status | Text-weight success label (minimal pill optional) |
| Mobile | Same structure; less chrome height → more table |
| Risks | May feel “under-branded” vs Deed navy/cyan; staff used to coloured pilots may miss landmarks |

```
[Side ][ Topbar: Sales ]
       [ Orders                     [New quotation] ]
       [ ———————————————————————— ]
       [ Tabs ]
       [ | Draft | Sent | Confirmed | To invoice | ]
       [ Search ]
       [ Table (hairline) ]
```

---

## Comparison (pre-approval)

| Criterion | A | B | C |
|-----------|---|---|---|
| Task efficiency | ●●●● | ●●●● | ●●●●○ |
| Hierarchy | ●●●● | ●●●●● | ●●●● |
| Brand alignment | ●●● | ●●●●● | ●●● |
| Accessibility | ●●●● | ●●●○* | ●●●●● |
| Responsiveness | ●●●● | ●●●● | ●●●●● |
| Table usability | ●●●●● | ●●●●● | ●●●●● |
| Form usability | ●●●● | ●●●● | ●●●● |
| Maintainability | ●●●●● | ●●●● | ●●● |
| Distinctiveness | ●●● | ●●●● | ●●●●● |
| MASTER.md fit | ●●●●● | ●●●● | ●●●● |

\*B: verify cyan-on-navy contrast for CTA label.

---

## Recommendation (non-binding)

For a **Sales-first** restyle with low churn: **Direction A**.  
For **cross-module brand unity** with Inventory: **Direction B**.  
For a **system-wide chrome rethink** later: **Direction C**.

---

## Stop

**Await direction approval** before Phase 5.  
Phase 5 requires installing the **`prototype`** skill and isolated worktrees — do not start until then.
