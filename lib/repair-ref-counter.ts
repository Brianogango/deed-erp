import 'server-only'

import { allocateRepairRef } from './repair-ref'

/**
 * Allocate a unique, unguessable repair reference.
 * Sequential `REP/0001` counters made public portal URLs enumerable.
 * Existing sequential tickets stay valid; only new allocations are random.
 */
export async function getNextRepairRef(taken: Iterable<string> = []): Promise<string> {
  try {
    return allocateRepairRef(taken)
  } catch (err) {
    console.error('[repair-ref-counter] getNextRepairRef error:', err)
    throw err
  }
}
