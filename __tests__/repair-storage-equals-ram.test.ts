import { describe, expect, it } from 'vitest'
import { driveFromText } from '../scripts/repair-storage-equals-ram.mjs'
import { parseSpecsString } from '@/lib/reconfiguration/display-name'

describe('repair script reads the drive like the app', () => {
  it('matches parseSpecsString on the formats that went wrong', () => {
    for (const s of ['HP Elitebook 820 G3 - Intel Core i5 6th Gen - 8GB RAM 256GB SSD', '16GB DDR4 512GB NVMe SSD', '8GB RAM 1TB HDD', 'Core i5, 8GB, 13.3" , 128GB SSD']) {
      expect(driveFromText(s)?.gb).toBe(parseSpecsString(s).primaryStorageGb)
    }
  })
  it('finds nothing when the text names no drive', () => {
    expect(driveFromText('Intel Core i5 6th Gen - 8GB RAM')).toBeNull()
  })
})
