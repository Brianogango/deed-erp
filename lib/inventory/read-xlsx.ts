/** First sheet of an uploaded Excel file as rows (header → value). Browser only; check the file with lib/spreadsheet-guard first. */
import { loadXlsx } from '@/lib/xlsx-lazy'

export async function readXlsx(file: File): Promise<any[]> {
  const XLSX = await loadXlsx()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        resolve(XLSX.utils.sheet_to_json<any>(ws))
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}
