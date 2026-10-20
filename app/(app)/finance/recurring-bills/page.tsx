import { redirect } from 'next/navigation'

// Recurring bills live under Finance → Bills now.
export default function RecurringBillsPage() {
  redirect('/finance?tab=recurring_bills')
}
