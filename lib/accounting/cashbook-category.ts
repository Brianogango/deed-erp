import { aggregateLinesByAccount, type AccountableProduct } from '@/lib/product-accounts'

/**
 * The "COA account" shown beside a sale in the Cashbook: the revenue account(s)
 * the sale was posted to — the same product → category → company-default
 * lookup the ledger uses when it posts the invoice — instead of one fixed
 * account for every sale.
 *
 * A sale spread over several accounts shows the biggest one and "+N more";
 * `title` lists every account with its share, for the badge's tooltip.
 */
export function saleCategoryLabel(args: {
  lines: Array<{ productId?: string; subtotal: number; accountCode?: string; lineType?: 'item' | 'section' }>
  products: Array<AccountableProduct & { id: string }>
  accounts: Array<{ code: string; name: string }>
}): { label: string; title: string } {
  const byId = new Map<string, AccountableProduct>()
  for (const p of args.products) {
    if (p?.id) byId.set(p.id, p)
  }
  const buckets = aggregateLinesByAccount({
    lines: args.lines,
    resolveProduct: id => byId.get(id),
    side: 'revenue',
    accounts: args.accounts,
  }).sort((a, b) => b.amount - a.amount)

  if (!buckets.length) return { label: 'Sales Revenue', title: 'Sales Revenue' }
  const name = (account: string) => account.includes(' - ') ? account.slice(account.indexOf(' - ') + 3) : account
  const title = buckets
    .map(b => `${b.account}: KES ${Math.round(b.amount).toLocaleString('en-KE')}`)
    .join('\n')
  const first = name(buckets[0].account)
  return {
    label: buckets.length === 1 ? first : `${first} +${buckets.length - 1} more`,
    title,
  }
}
