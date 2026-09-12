/** Next 15 passes `params` as a Promise; Next 14 passed a plain object. */
export type RouteParams<T extends Record<string, string> = { id: string }> = T | Promise<T>

export async function resolveRouteParams<T extends Record<string, string>>(
  params: RouteParams<T>,
): Promise<T> {
  return await params
}
