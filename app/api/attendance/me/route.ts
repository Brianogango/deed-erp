import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { clientIpOrNull } from '@/lib/client-ip'
import { listPasskeys } from '@/lib/auth/passkeys'
import { employeeForUser, getDay, onOfficeNetwork, listOfficeNetworks, listDays } from '@/lib/hr/attendance.server'
import { monthRange, nairobiDate, payableDays, workingDaysBetween } from '@/lib/hr/attendance-core'

export const dynamic = 'force-dynamic'

/** The signed-in person's clock: today's day, whether they are on an office connection, and whether Face ID / fingerprint is set up. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { user } = await getRequiredSession()
    const employee = await employeeForUser(user)
    const ip = clientIpOrNull(request.headers)
    const day = nairobiDate()
    const month = monthRange(day.slice(0, 7))
    const [today, inOffice, passkeys, networks, monthDays] = await Promise.all([
      employee ? getDay(employee.id, day) : null,
      onOfficeNetwork(ip),
      listPasskeys(user.id).catch(() => []),
      listOfficeNetworks(),
      employee ? listDays({ from: month.from, to: month.to, employeeId: employee.id }).catch(() => []) : [],
    ])
    return NextResponse.json({
      employee: employee ? { id: employee.id, name: `${employee.firstName} ${employee.lastName}`.trim() } : null,
      today,
      inOffice,
      officeNetworksSet: networks.length > 0,
      hasPasskey: passkeys.length > 0,
      // This month so far: days that count for pay, out of the working days.
      month: { worked: payableDays(monthDays), of: workingDaysBetween(month.from, month.to) },
    }, { headers: { 'Cache-Control': 'no-store' } })
  })
}
