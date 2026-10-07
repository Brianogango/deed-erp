const SPREADSHEET_MAX_BYTES = 5 * 1024 * 1024  // 5 MB
const SPREADSHEET_MAX_ROWS  = 2_000

export class SpreadsheetGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpreadsheetGuardError'
  }
}

/** Call before passing the File to FileReader / XLSX.read */
export function guardSpreadsheetFile(file: File): void {
  if (!file || file.size === 0)
    throw new SpreadsheetGuardError('File is empty.')

  if (file.size > SPREADSHEET_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1)
    throw new SpreadsheetGuardError(
      `File is too large (${mb} MB). Maximum allowed is 5 MB. Please split the data into smaller files.`
    )
  }
}

/** Call after XLSX / CSV parsing, before processing rows */
export function guardSpreadsheetRows(rows: unknown[]): void {
  if (rows.length > SPREADSHEET_MAX_ROWS)
    throw new SpreadsheetGuardError(
      `File has ${rows.length.toLocaleString()} rows — maximum is ${SPREADSHEET_MAX_ROWS.toLocaleString()}. Please split into smaller batches.`
    )
}
