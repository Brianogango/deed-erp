import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { loadAppState, loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { riderCookieName, sessionValid, type JobLike, type PayLike, type RiderLike } from './rider-portal'

export const noStore = { 'Cache-Control': 'no-store' }

/** The active rider this link belongs to, or null. */
export async function riderForToken(token: string): Promise<RiderLike | null> {
  const clean = String(token ?? '').trim()
  if (clean.length < 16) return null
  const state = await loadAppState(['deed_riders'])
  const riders = Array.isArray(state.deed_riders) ? state.deed_riders as RiderLike[] : []
  return riders.find(r => r.portalToken === clean && r.active !== false) ?? null
}

export function hasRiderSession(req: NextRequest, rider: RiderLike): boolean {
  return sessionValid(rider, req.cookies.get(riderCookieName(rider.id))?.value)
}

export const needPin = (rider: RiderLike) =>
  NextResponse.json({ needPin: true, firstName: rider.name.split(/\s+/)[0] }, { status: 401, headers: noStore })

export async function loadRiderData(): Promise<{ jobs: JobLike[]; pays: PayLike[] }> {
  const state = await loadAppState(['deed_deliveryJobs', 'deed_riderWeeklyPays'])
  return {
    jobs: Array.isArray(state.deed_deliveryJobs) ? state.deed_deliveryJobs as JobLike[] : [],
    pays: Array.isArray(state.deed_riderWeeklyPays) ? state.deed_riderWeeklyPays as PayLike[] : [],
  }
}

/** Change one delivery job under the store lock. */
export async function updateDeliveryJob(
  jobId: string,
  change: (job: JobLike) => { ok: true; job: JobLike } | { ok: false; error: string },
): Promise<{ ok: true; job: JobLike; before: JobLike } | { ok: false; error: string; status: number }> {
  return withAppStateKeyLock('deed_deliveryJobs', async () => {
    const state = await loadAppStateForWrite(['deed_deliveryJobs'])
    const jobs = Array.isArray(state.deed_deliveryJobs) ? [...state.deed_deliveryJobs as JobLike[]] : []
    const idx = jobs.findIndex(j => j.id === jobId)
    if (idx === -1) return { ok: false as const, error: 'Job not found', status: 404 }
    const before = jobs[idx]
    const result = change(before)
    if (!result.ok) return { ok: false as const, error: result.error, status: 409 }
    if (result.job === before) return { ok: true as const, job: before, before }
    jobs[idx] = result.job
    await saveStoreKeys({ deed_deliveryJobs: JSON.stringify(jobs) })
    return { ok: true as const, job: result.job, before }
  })
}

/** Set or reset a rider's personal link. Returns the new token. */
export async function setRiderToken(riderId: string, token: string): Promise<RiderLike | null> {
  return withAppStateKeyLock('deed_riders', async () => {
    const state = await loadAppStateForWrite(['deed_riders'])
    const riders = Array.isArray(state.deed_riders) ? [...state.deed_riders as RiderLike[]] : []
    const idx = riders.findIndex(r => r.id === riderId)
    if (idx === -1) return null
    riders[idx] = { ...riders[idx], portalToken: token }
    await saveStoreKeys({ deed_riders: JSON.stringify(riders) })
    return riders[idx]
  })
}
