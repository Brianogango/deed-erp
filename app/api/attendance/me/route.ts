import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { clientIpOrNull } from '@/lib/client-ip'
import { listPasskeys } from '@/lib/auth/passkeys'
import { employeeForUser, getDay, onOfficeNetwork, listOfficeNetworks } from '@/lib/hr/attendance.server'
import { nairobiDate } from '@/lib/hr/attendance-core'

export const dynamic = 'force-dynamic'

/** The signed-in person's clock: today's day, whether they are on an office connection, and whether Face ID / fingerprint is set up. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { user } = await getRequiredSession()
    const employee = await employeeForUser(user)
    const ip = clientIpOrNull(request.headers)
    const [today, inOffice, passkeys, networks] = await Promise.all([
      employee ? getDay(employee.id, nairobiDate()) : null,
      onOfficeNetwork(ip),
      listPasskeys(user.id).catch(() => []),
      listOfficeNetworks(),
    ])
    return NextResponse.json({
      employee: employee ? { id: employee.id, name: `${employee.firstName} ${employee.lastName}`.trim() } : null,
      today,
      inOffice,
      officeNetworksSet: networks.length > 0,
      hasPasskey: passkeys.length > 0,
    }, { headers: { 'Cache-Control': 'no-store' } })
  })
}
