/**
 * Sales-facing laptop descriptions: screen, touch vs clamshell/x360, GPU,
 * plus CPU / RAM / storage already on the catalog title.
 *
 * Does not invent ports, nits, colours, or warranty. Skip rows that are
 * already retail-detailed (OmniBook-style) or are not notebooks.
 */

import { parseSpecsString } from '@/lib/reconfiguration/display-name'

export type LaptopDisplayFacts = {
  screenSize: string | null
  resolution: string | null
  touch: boolean | null
  form: 'x360 convertible' | '2-in-1' | 'clamshell' | null
  graphics: string | null
}

type FamilyHint = LaptopDisplayFacts & { test: RegExp }

const FAMILIES: FamilyHint[] = [
  { test: /elitebook\s*x360\s*830|830\s*g\d+\s*x360|x360\s*830/i, screenSize: '13.3', resolution: 'FHD (1920 x 1080)', touch: true, form: 'x360 convertible', graphics: null },
  { test: /elitebook\s*830/i, screenSize: '13.3', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /elitebook\s*820/i, screenSize: '12.5', resolution: 'HD (1366 x 768)', touch: false, form: 'clamshell', graphics: null },
  { test: /elitebook\s*folio\s*1040|folio\s*1040/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /elite\s*dragonfly|elitedragonfly/i, screenSize: '13.5', resolution: '3:2 (1920 x 1280)', touch: true, form: 'x360 convertible', graphics: null },
  { test: /elitebook\s*845/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /elitebook\s*840/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /elitebook\s*850/i, screenSize: '15.6', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /elitebook\s*725/i, screenSize: '12.5', resolution: 'HD (1366 x 768)', touch: false, form: 'clamshell', graphics: null },
  { test: /elitebook\s*745/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /zbook\s*firefly/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /zbook\s*14/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /zbook\s*15/i, screenSize: '15.6', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /zbook\s*17/i, screenSize: '17.3', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /probook\s*11/i, screenSize: '11.6', resolution: 'HD (1366 x 768)', touch: false, form: 'clamshell', graphics: null },
  { test: /pro\s*x2\s*612|x2\s*210/i, screenSize: '12', resolution: 'HD', touch: true, form: '2-in-1', graphics: null },
  { test: /probook\s*430/i, screenSize: '13.3', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /probook\s*440|probook\s*4g1ir\s*14|probook\s*14/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /probook\s*450/i, screenSize: '15.6', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /probook\s*460/i, screenSize: '16', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /probook\s*470/i, screenSize: '17.3', resolution: 'HD+ (1600 x 900)', touch: false, form: 'clamshell', graphics: null },
  { test: /probook\s*640/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /probook\s*650/i, screenSize: '15.6', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /probook\s*350/i, screenSize: '15.6', resolution: 'HD (1366 x 768)', touch: false, form: 'clamshell', graphics: null },
  { test: /spectre\s*x360\s*convertible\s*15|spectre\s*x360.*15/i, screenSize: '15.6', resolution: 'FHD (1920 x 1080)', touch: true, form: 'x360 convertible', graphics: null },
  { test: /envy\s*x360\s*13/i, screenSize: '13.3', resolution: '1920 x 1200', touch: true, form: 'x360 convertible', graphics: null },
  { test: /omnibook.*16-as|omnibook.*16\s/i, screenSize: '16', resolution: '3K (2880 x 1800)', touch: true, form: '2-in-1', graphics: 'Intel Arc Graphics' },
  { test: /omnibook/i, screenSize: '14', resolution: '2K (1920 x 1200)', touch: true, form: '2-in-1', graphics: 'Intel Arc Graphics' },
  { test: /pavilion/i, screenSize: '15.6', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: 'Intel UHD Graphics' },
  { test: /omen\s*16/i, screenSize: '16', resolution: '2K', touch: false, form: 'clamshell', graphics: null },
  { test: /notebook\s*245|250r\s*g10|\bhp\s*250\b/i, screenSize: '15.6', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /15s-|laptop\s*15s|hp\s*15[\s-]/i, screenSize: '15.6', resolution: 'HD (1366 x 768)', touch: false, form: 'clamshell', graphics: null },
  { test: /chromebook\s*11|stream\s*11/i, screenSize: '11.6', resolution: 'HD (1366 x 768)', touch: false, form: 'clamshell', graphics: null },
  { test: /e410/i, screenSize: '14', resolution: 'HD (1366 x 768)', touch: false, form: 'clamshell', graphics: 'Intel UHD Graphics' },
  { test: /x1404|vivobook\s*14/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: 'Intel UHD Graphics' },
  { test: /x1504|vivobook\s*15/i, screenSize: '15.6', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: 'Intel UHD Graphics' },
  { test: /latitude\s*3190/i, screenSize: '11.6', resolution: 'HD (1366 x 768)', touch: true, form: '2-in-1', graphics: 'Intel UHD Graphics' },
  { test: /latitude\s*(?:e?34|e?54|e?74|e?73|e?72)\d{2}/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /latitude\s*(?:e?35|e?55)\d{2}/i, screenSize: '15.6', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /latitude\s*53\d{2}/i, screenSize: '13.3', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /precision\s*55\d{2}/i, screenSize: '15.6', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /precision\s*75\d{2}|precision\s*m6800|precision\s*77\d{2}/i, screenSize: '17.3', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /vostro\s*3530|vostro\s*15/i, screenSize: '15.6', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /xps\s*13/i, screenSize: '13.3', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /travelmate\s*p645/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: 'Intel HD Graphics' },
  { test: /macbook\s*air.*m1|a2337/i, screenSize: '13.3', resolution: '2560 x 1600', touch: false, form: 'clamshell', graphics: 'Apple 7-core GPU' },
  { test: /macbook\s*air.*201[5-7]/i, screenSize: '13.3', resolution: '1440 x 900', touch: false, form: 'clamshell', graphics: 'Intel HD Graphics 6000' },
  { test: /macbook\s*air.*13\.6|m5 chip/i, screenSize: '13.6', resolution: 'Liquid Retina (2560 x 1664)', touch: false, form: 'clamshell', graphics: null },
  { test: /thinkpad\s*x1\s*yoga/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: true, form: 'x360 convertible', graphics: null },
  { test: /thinkpad\s*x1\s*carbon/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /thinkpad\s*x13/i, screenSize: '13.3', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /thinkpad\s*13\b/i, screenSize: '13.3', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /thinkpad\s*11e|100e|chromebook\s*100e/i, screenSize: '11.6', resolution: 'HD (1366 x 768)', touch: false, form: 'clamshell', graphics: 'Intel UHD Graphics' },
  { test: /thinkpad\s*t14s|thinkpad\s*t14|thinkbook\s*14|thinkpad\s*e14|thinkpad\s*l490|thinkpad\s*t480|thinkpad\s*t470|thinkpad\s*l470|thinkpad\s*t495/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /thinkpad\s*e560|thinkpad\s*e570|thinkpad\s*l540|thinkpad\s*l560|thinkpad\s*t560|thinkpad\s*p51/i, screenSize: '15.6', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /surface\s*laptop\s*go/i, screenSize: '12.4', resolution: '1536 x 1024', touch: true, form: 'clamshell', graphics: 'Intel UHD Graphics' },
  { test: /surface\s*pro/i, screenSize: '12.3', resolution: '2736 x 1824', touch: true, form: '2-in-1', graphics: 'Intel HD Graphics' },
  { test: /portege\s*x30/i, screenSize: '13.3', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
  { test: /versa\s*pro\s*2-in-1|versapro\s*2-in-1|vee\s*x360/i, screenSize: '12.5', resolution: 'FHD (1920 x 1080)', touch: true, form: '2-in-1', graphics: 'Intel HD Graphics' },
  { test: /lifebook/i, screenSize: '14', resolution: 'FHD (1920 x 1080)', touch: false, form: 'clamshell', graphics: null },
]

export function shouldSkipLaptopCatalogRow(name: string): boolean {
  const n = String(name || '').trim()
  if (!n) return true
  if (/^\s*battery\b/i.test(n) || /\bbattery\b.{0,40}thinkpad/i.test(n)) return true
  if (/\ball[-\s]?in[-\s]?one\b/i.test(n) || /\bimac\b/i.test(n)) return true
  return false
}

export function isDetailedLaptopDescription(text: string | null | undefined): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (t.length < 90) return false
  if (/configured with/i.test(t) && t.length < 160 && !/display|inch|touch|graphics|usb|hdmi/i.test(t)) {
    return false
  }
  const hasDisplay = /inch|display|screen|touchscreen|multi-touch/i.test(t)
  const hasExtra = /usb|hdmi|thunderbolt|graphics|gpu|uhd|iris|arc |mx\d|rtx|gtx|radeon|nits|wifi|warranty|camera|onboard/i.test(t)
  const commas = (t.match(/,/g) || []).length
  return hasDisplay && (hasExtra || commas >= 4)
}

function familyFor(name: string): LaptopDisplayFacts | null {
  for (const row of FAMILIES) {
    if (row.test.test(name)) {
      return {
        screenSize: row.screenSize,
        resolution: row.resolution,
        touch: row.touch,
        form: row.form,
        graphics: row.graphics,
      }
    }
  }
  return null
}

function parseDisplayFromText(text: string): Partial<LaptopDisplayFacts> {
  const raw = String(text || '')
  const screenMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:-inch|inch(?:es)?|["”''″])/i)
  const resMatch = raw.match(/\b(\d{3,4}\s*[x×*]\s*\d{3,4})\b/i)
    || raw.match(/\b(fhd|2k|3k|4k|uhd|hd\+|hd|oled|liquid retina)\b/i)
  const namedGpu = raw.match(
    /nvidia[^,]*|quadro[^,]*|geforce[^,]*|rtx\s*\d+[^,]*|gtx\s*\d+[^,]*|(?:intel\s+)?iris\s*xe[^,]*|(?:intel\s+)?uhd\s+graphics[^,]*|(?:intel\s+)?arc(?:\s+\d+\w*)?(?:\s+gpu)?(?:\s*\(\d+\s*GB\))?|radeon[^,]*|apple\s+\d+[-\s]?core\s+gpu/i,
  )
  const nonTouch = /non[-\s]?touch/i.test(raw)
  const touch = nonTouch ? false : /touchscreen|multi-touch|(?:\btouch\b(?!\s*id))/i.test(raw)
  let form: LaptopDisplayFacts['form'] | null = null
  if (/x360/i.test(raw)) form = 'x360 convertible'
  else if (/2\s*-?\s*in\s*-?\s*1|flip|yoga|convertible/i.test(raw)) form = '2-in-1'
  let resolution: string | null = null
  if (resMatch) {
    const token = resMatch[1].replace(/\*/g, ' x ').replace(/×/g, ' x ')
    if (/^\d/.test(token)) resolution = token.replace(/\s+/g, ' ')
    else if (/fhd/i.test(token)) resolution = 'FHD (1920 x 1080)'
    else if (/2k/i.test(token)) resolution = '2K (1920 x 1200)'
    else if (/3k/i.test(token)) resolution = '3K (2880 x 1800)'
    else if (/liquid retina/i.test(token)) resolution = 'Liquid Retina (2560 x 1664)'
    else resolution = token
  }
  return {
    screenSize: screenMatch ? String(Number(screenMatch[1])) : null,
    resolution,
    touch: nonTouch ? false : touch ? true : null,
    form,
    graphics: namedGpu ? namedGpu[0].replace(/\s+/g, ' ').trim() : null,
  }
}

function defaultIntelGraphics(name: string): string | null {
  const n = name.toLowerCase()
  if (/amd|ryzen|apple\s+m\d|celeron|pentium|atom|xeon/.test(n) && !/intel/.test(n)) {
    if (/ryzen/.test(n)) return 'AMD Radeon Graphics'
    if (/apple\s+m1/.test(n)) return 'Apple 7-core GPU'
    return null
  }
  const gen = n.match(/(\d+)(?:st|nd|rd|th)(?:\s*gen)?/)
  const genN = gen ? Number(gen[1]) : NaN
  if (/ultra\s*[579]|core\s*ultra/.test(n)) return 'Intel Arc Graphics'
  if (genN >= 11 || /i[57]-1[1-9]/.test(n)) return 'Intel Iris Xe Graphics'
  if (genN >= 8) return 'Intel UHD Graphics'
  if (genN >= 4) return 'Intel HD Graphics'
  return 'Intel UHD Graphics'
}

export function inferLaptopDisplay(name: string): LaptopDisplayFacts {
  const family = familyFor(name)
  const parsed = parseDisplayFromText(name)
  const convertible = parsed.form === 'x360 convertible' || parsed.form === '2-in-1'
    || family?.form === 'x360 convertible' || family?.form === '2-in-1'
  const touch = parsed.touch != null ? parsed.touch : convertible ? true : (family?.touch ?? false)
  const form = parsed.form || (touch && convertible ? family?.form || '2-in-1' : family?.form) || (convertible ? '2-in-1' : 'clamshell')
  return {
    screenSize: parsed.screenSize || family?.screenSize || null,
    resolution: parsed.resolution || family?.resolution || null,
    touch,
    form,
    graphics: parsed.graphics || family?.graphics || defaultIntelGraphics(name),
  }
}

function extraCpu(name: string): string | null {
  const m = name.match(
    /intel\s+core\s+ultra\s+[3579]\s*\d*|core\s+ultra\s+[3579]\s*\d*|intel\s+core\s+[357]\s*[- ]?\d+u|intel\s+celeron(?:\s+n?\d+)?|intel\s+pentium(?:\s+silver)?|intel\s+xeon|intel\s+atom|amd\s+ryzen(?:\s+\d)?(?:\s+pro)?(?:\s+\d+\w*)?/i,
  )
  return m ? m[0].replace(/\s+/g, ' ').trim() : null
}

function ramStorageFromName(name: string): { ram: string; storage: string } {
  const ramMatch = name.match(/(\d+)\s*GB\s*(?:LPDDR\d+x?(?:-\d+)?|DDR\d+)?\s*(?:onboard\s*)?(?:RAM|memory)\b/i)
    || name.match(/\b(\d+)\s*G\s+256GB/i)
  const storageMatch = name.match(
    /(\d+(?:\.\d+)?)\s*(TB|GB)\s*(?:M\.2\s+)?(?:PCIe[^\s,]*\s*)?(?:Gen\d+\s+)?(?:NVMe\s+)?(SSD|HDD|Storage)\b/i,
  )
  const ram = ramMatch ? `${ramMatch[1]}GB RAM` : ''
  let storage = ''
  if (storageMatch) {
    const n = Number(storageMatch[1])
    const unit = storageMatch[2].toUpperCase()
    const kind = /hdd/i.test(storageMatch[3]) ? 'HDD' : /nvme/i.test(storageMatch[0]) ? 'NVMe SSD' : storageMatch[3]
    storage = unit === 'TB' ? `${n}TB ${kind}` : `${n}GB ${kind}`
  }
  return { ram, storage }
}

function configBits(name: string): string[] {
  const parsed = parseSpecsString(name)
  const explicit = ramStorageFromName(name)
  const cpu = [parsed.processorGeneration, parsed.processor].filter(Boolean).join(' ').trim()
    || extraCpu(name)
    || ''
  const ram = explicit.ram || (parsed.totalRamGb && parsed.totalRamGb > 0 ? `${parsed.totalRamGb}GB RAM` : '')
  let storage = explicit.storage
  if (!storage && parsed.primaryStorageGb && parsed.primaryStorageGb > 0) {
    const gb = parsed.primaryStorageGb
    const size = gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024}TB` : `${gb}GB`
    const kind = String(parsed.storageType || 'SSD').replace(/nvme ssd/i, 'NVMe SSD')
    storage = `${size} ${kind}`
  }
  return [cpu, ram, storage].filter(Boolean)
}

function displayClause(facts: LaptopDisplayFacts): string | null {
  if (!facts.screenSize) return null
  const bits = [`${facts.screenSize}-inch`]
  if (facts.resolution) bits.push(facts.resolution)
  bits.push(facts.touch ? 'multi-touch' : 'non-touch')
  if (facts.form === 'x360 convertible') bits.push('x360 convertible')
  else if (facts.form === '2-in-1') bits.push('2-in-1')
  else bits.push('clamshell')
  bits.push('display')
  return bits.join(' ')
}

export function buildLaptopSalesDescription(name: string): string | null {
  const title = String(name || '').replace(/\s+/g, ' ').trim()
  if (!title || shouldSkipLaptopCatalogRow(title)) return null
  const facts = inferLaptopDisplay(title)
  const display = displayClause(facts)
  const parts = [...configBits(title)]
  if (display) parts.push(display)
  if (facts.graphics) parts.push(facts.graphics)
  if (!display && parts.length < 2) return null
  let text = parts.join(', ')
  if (!/[.!?]$/.test(text)) text += '.'
  return text.slice(0, 1000)
}

export function planLaptopDescriptionUpdate(opts: {
  name: string
  description?: string | null
}): { action: 'skip-detailed' | 'skip-not-laptop' | 'skip-unchanged' | 'skip-insufficient' | 'update'; next: string | null } {
  if (shouldSkipLaptopCatalogRow(opts.name)) {
    return { action: 'skip-not-laptop', next: null }
  }
  if (isDetailedLaptopDescription(opts.description)) {
    return { action: 'skip-detailed', next: String(opts.description).trim() }
  }
  const next = buildLaptopSalesDescription(opts.name)
  if (!next) return { action: 'skip-insufficient', next: null }
  const current = String(opts.description || '').replace(/\s+/g, ' ').trim()
  if (current && current.toLowerCase() === next.toLowerCase()) {
    return { action: 'skip-unchanged', next }
  }
  return { action: 'update', next }
}
