import { ShellChromeSkeleton } from '@/components/ui/ModuleSkeleton'

/**
 * Shown only if the root segment suspends (rare). Authenticated navigations
 * keep AppShell mounted via `app/(app)/layout.tsx`; that group has its own
 * content-only `loading.tsx`.
 */
export default function RootLoading() {
  return <ShellChromeSkeleton />
}
