/**
 * Clip configuration snapshot strings to the Postgres column widths.
 * Catalog titles (Lenovo/HP spec blobs) exceed the original varchar(300)
 * display_name and overflow processor/graphics when the full vendor title
 * is copied into those fields.
 */

export const SNAPSHOT_FIELD_MAX = {
  displayName: 1000,
  processor: 500,
  processorGeneration: 80,
  graphics: 500,
  storageType: 40,
} as const

export function clipSnapshotText(
  value: string | null | undefined,
  max: number,
): string | null {
  if (value == null) return null
  const s = String(value)
  if (!s) return null
  return s.length <= max ? s : s.slice(0, max)
}

export function snapshotTextFields(input: {
  processor?: string | null
  processorGeneration?: string | null
  storageType?: string | null
  graphics?: string | null
  displayName?: string | null
}) {
  return {
    processor: clipSnapshotText(input.processor, SNAPSHOT_FIELD_MAX.processor),
    processorGeneration: clipSnapshotText(
      input.processorGeneration,
      SNAPSHOT_FIELD_MAX.processorGeneration,
    ),
    storageType: clipSnapshotText(input.storageType, SNAPSHOT_FIELD_MAX.storageType),
    ...(input.graphics !== undefined
      ? { graphics: clipSnapshotText(input.graphics, SNAPSHOT_FIELD_MAX.graphics) }
      : {}),
    displayName: clipSnapshotText(input.displayName, SNAPSHOT_FIELD_MAX.displayName) || 'Device',
  }
}
