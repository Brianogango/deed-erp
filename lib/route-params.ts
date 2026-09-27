/**
 * Next 15 passes a route's `params` as a Promise, always.
 *
 * This was a union — `T | Promise<T>` — carried over from Next 14, which
 * passed a plain object. Next 15's generated route checks demand exactly
 * `Promise<any>`, and a union does not satisfy that, so every route using this
 * type failed a from-scratch build. It went unnoticed because `next build`
 * reuses the type-check cache in the dist directory: rebuilding over an
 * existing .next passes, and only a clean build (a fresh checkout, a cleared
 * cache, or a staged build into another distDir) surfaces it.
 *
 * `resolveRouteParams` still awaits, so a plain object passed at runtime — by
 * a test, or by an older caller — resolves exactly as before. Only the type
 * narrows.
 */
export type RouteParams<T extends Record<string, string> = { id: string }> = Promise<T>

export async function resolveRouteParams<T extends Record<string, string>>(
  params: RouteParams<T> | T,
): Promise<T> {
  return await params
}
