import { redirect } from 'next/navigation'

export default async function CashbookRoute() {
  redirect('/finance?tab=cashbook')
}
