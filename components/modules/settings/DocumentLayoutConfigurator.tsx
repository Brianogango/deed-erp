'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CompanySettings } from '@/lib/store'
import { readGuardedImageAsDataUrl } from '@/lib/client-image-guard'
import { compressCompanyLogoDataUrl } from '@/lib/pdf-logo'
import {
  DOCUMENT_FONT_OPTIONS,
  DOCUMENT_LAYOUT_OPTIONS,
  normalizeDocumentBackground,
  normalizeDocumentFont,
  normalizeDocumentLayout,
  normalizeHexColor,
  normalizePaperFormat,
  type DocumentBackgroundId,
  type DocumentFontId,
  type DocumentLayoutId,
  type DocumentPaperFormat,
} from '@/lib/document-layout'

type Props = {
  company: CompanySettings
  updateCompany: (patch: Partial<CompanySettings>) => void
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void
}

type Draft = {
  printTemplate: DocumentLayoutId
  printFont: DocumentFontId
  printBackground: DocumentBackgroundId
  printPrimaryColor: string
  printSecondaryColor: string
  logoUrl: string
  address: string
  printTagline: string
  invoiceFooter: string
  printPaperFormat: DocumentPaperFormat
}

const fontFamily: Record<DocumentFontId, string> = {
  lato: 'Lato, Arial, sans-serif',
  roboto: 'Roboto, Arial, sans-serif',
  open_sans: '"Open Sans", Arial, sans-serif',
  montserrat: 'Montserrat, Arial, sans-serif',
  raleway: 'Raleway, Arial, sans-serif',
  times: '"Times New Roman", serif',
  courier: '"Courier New", monospace',
}

function toDraft(company: CompanySettings): Draft {
  return {
    printTemplate: normalizeDocumentLayout(company.printTemplate),
    printFont: normalizeDocumentFont(company.printFont),
    printBackground: normalizeDocumentBackground(company.printBackground),
    printPrimaryColor: normalizeHexColor(company.printPrimaryColor, '#1B2762'),
    printSecondaryColor: normalizeHexColor(company.printSecondaryColor, '#00AEEF'),
    logoUrl: company.logoUrl || '',
    address: company.address || '',
    printTagline: company.printTagline || '',
    invoiceFooter: company.invoiceFooter || '',
    printPaperFormat: normalizePaperFormat(company.printPaperFormat),
  }
}

function LayoutChrome({ layout, primary, secondary, compact = false }: {
  layout: DocumentLayoutId
  primary: string
  secondary: string
  compact?: boolean
}) {
  const height = compact ? 12 : 56
  return (
    <span className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden" style={{ height }}>
      {layout === 'bold' && <span className="absolute inset-0" style={{ backgroundColor: primary }} />}
      {layout === 'striped' && <>
        <span className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: primary }} />
        <span className="absolute left-0 top-[5px] h-[2px] w-2/3" style={{ backgroundColor: secondary }} />
      </>}
      {layout === 'bubble' && <>
        <span className="absolute -right-5 -top-7 h-16 w-16 rounded-full opacity-95" style={{ backgroundColor: primary }} />
        <span className="absolute right-9 -top-4 h-8 w-8 rounded-full opacity-25" style={{ backgroundColor: secondary }} />
      </>}
      {layout === 'wave' && <>
        <span className="absolute -right-12 -top-12 h-20 w-2/3 -rotate-3 rounded-[0_0_70%_70%]" style={{ backgroundColor: primary }} />
        <span className="absolute -right-16 -top-8 h-16 w-1/2 -rotate-6 rounded-[0_0_65%_70%] opacity-90" style={{ backgroundColor: secondary }} />
      </>}
      {layout === 'folder' && <>
        <span className="absolute left-0 top-0 h-full w-[38%]" style={{ backgroundColor: primary }} />
        <span className="absolute right-0 top-0 h-full w-[64%]" style={{ backgroundColor: secondary }} />
        <span className="absolute left-[30%] top-0 h-full w-10 -skew-x-[24deg]" style={{ backgroundColor: primary }} />
      </>}
    </span>
  )
}

function LayoutThumbnail({ layout, primary, secondary }: {
  layout: DocumentLayoutId
  primary: string
  secondary: string
}) {
  const inverse = layout === 'bold' || layout === 'folder'
  return (
    <span className={`relative block aspect-[1.414/1] overflow-hidden rounded-[3px] border bg-white ${layout === 'boxed' ? 'border-2' : 'border-gray-300'} shadow-[0_1px_2px_rgba(15,23,42,.08)]`} style={layout === 'boxed' ? { borderColor: primary } : undefined}>
      <LayoutChrome layout={layout} primary={primary} secondary={secondary} compact />
      <span className="relative flex h-full flex-col px-2 pb-1.5 pt-2">
        <span className="flex items-start justify-between">
          <span className="text-[5px] font-black tracking-tight" style={{ color: inverse ? '#fff' : primary }}>deed</span>
          <span className="text-right text-[2.5px] leading-tight" style={{ color: inverse ? '#fff' : '#64748b' }}>COMPANY<br/>DETAILS</span>
        </span>
        <span className="mt-1.5 text-[4px] font-black tracking-[.08em]" style={{ color: layout === 'bold' ? secondary : primary }}>INVOICE</span>
        <span className="mt-1 flex justify-between border-b pb-1 text-[2.5px] text-gray-500" style={{ borderColor: secondary }}>
          <span>BILL TO</span><span>REFERENCE · DATE</span>
        </span>
        <span className="mt-1 grid grid-cols-[1fr_18px_25px] text-[2.5px] font-bold text-white" style={{ backgroundColor: primary }}>
          <span className="px-1 py-[2px]">DESCRIPTION</span><span className="py-[2px] text-center">QTY</span><span className="px-1 py-[2px] text-right">AMOUNT</span>
        </span>
        {[0, 1, 2].map(row => <span key={row} className="grid grid-cols-[1fr_18px_25px] border-b border-gray-200 text-[2px] text-gray-400" style={{ backgroundColor: layout === 'striped' && row % 2 ? `${primary}0D` : '#fff' }}><span className="px-1 py-[2px]">—</span><span className="py-[2px] text-center">—</span><span className="px-1 py-[2px] text-right">—</span></span>)}
        <span className="mt-auto ml-auto text-[2.5px] font-bold" style={{ color: primary }}>TOTAL&nbsp;&nbsp; —</span>
      </span>
    </span>
  )
}

function DocumentPreview({ draft, company }: { draft: Draft; company: CompanySettings }) {
  const paperClass = draft.printPaperFormat === 'letter' ? 'aspect-[8.5/11]' : 'aspect-[210/297]'
  const inverse = draft.printTemplate === 'bold' || draft.printTemplate === 'folder'
  const partyRows = ['Customer', 'Address', 'Contact']
  const metaRows = ['Reference', 'Issue date', 'Due date']
  return (
    <div className="flex min-h-[650px] items-start justify-center overflow-auto bg-[#EEF1F5] p-6">
      <article className={`relative w-full max-w-[535px] overflow-hidden bg-white shadow-[0_8px_32px_rgba(15,23,42,.16)] ${paperClass}`} style={{ fontFamily: fontFamily[draft.printFont] }}>
        {draft.printBackground === 'demo_logo' && draft.logoUrl && <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.035]"><img src={draft.logoUrl} alt="" className="w-[58%] object-contain" /></div>}
        <LayoutChrome layout={draft.printTemplate} primary={draft.printPrimaryColor} secondary={draft.printSecondaryColor} />
        <header className={`relative mx-8 flex min-h-[92px] items-start justify-between pb-4 pt-7 ${draft.printTemplate === 'boxed' ? 'mt-5 rounded border px-4' : ''}`} style={draft.printTemplate === 'boxed' ? { borderColor: draft.printPrimaryColor } : undefined}>
          <div>
            {draft.logoUrl ? <img src={draft.logoUrl} alt="Company logo preview" className="h-11 max-w-[150px] object-contain object-left" /> : <div className="text-xl font-black tracking-tight" style={{ color: inverse ? '#fff' : draft.printPrimaryColor }}>{company.name || ''}</div>}
            {draft.printTagline && <p className="mt-1 text-[7px] italic" style={{ color: inverse ? '#fff' : draft.printSecondaryColor }}>{draft.printTagline}</p>}
          </div>
          <div className="max-w-[210px] whitespace-pre-line text-right text-[7px] leading-[1.55]" style={{ color: inverse ? '#fff' : '#475569' }}>
            {[draft.address, company.phone, company.email, company.website].filter(Boolean).join('\n')}
          </div>
        </header>

        <main className="relative px-9 pb-20 pt-3 text-[8px] text-slate-700">
          <section className="mb-6 flex items-end justify-between border-b pb-3" style={{ borderColor: draft.printSecondaryColor }}>
            <div>
              <p className="text-[20px] font-black tracking-[.08em]" style={{ color: draft.printTemplate === 'bold' ? draft.printSecondaryColor : draft.printPrimaryColor }}>INVOICE</p>
              <p className="mt-1 text-[7px] text-slate-400">Commercial document</p>
            </div>
            <div className="text-right text-[7px] text-slate-400">Document reference</div>
          </section>

          <section className={`mb-6 grid grid-cols-2 gap-8 p-4 ${draft.printTemplate === 'boxed' ? 'rounded border' : draft.printTemplate === 'bubble' ? 'rounded-2xl bg-slate-50' : ''}`} style={draft.printTemplate === 'boxed' ? { borderColor: draft.printPrimaryColor } : undefined}>
            <div><p className="mb-2 font-bold tracking-[.12em]" style={{ color: draft.printSecondaryColor }}>BILL TO</p>{partyRows.map(label => <div key={label} className="flex border-b border-slate-100 py-1.5"><span className="w-14 text-slate-400">{label}</span><span className="text-slate-300">—</span></div>)}</div>
            <div>{metaRows.map(label => <div key={label} className="flex justify-between border-b border-slate-100 py-1.5"><span className="font-semibold text-slate-500">{label}</span><span className="text-slate-300">—</span></div>)}</div>
          </section>

          <section className={`overflow-hidden ${draft.printTemplate === 'boxed' ? 'rounded border' : ''}`} style={draft.printTemplate === 'boxed' ? { borderColor: draft.printPrimaryColor } : undefined}>
            <div className="grid grid-cols-[1fr_42px_72px_76px] px-3 py-2.5 text-[6px] font-bold tracking-[.08em] text-white" style={{ backgroundColor: draft.printPrimaryColor }}><span>DESCRIPTION</span><span className="text-center">QTY</span><span className="text-right">UNIT PRICE</span><span className="text-right">AMOUNT</span></div>
            {[0,1,2,3].map(row => <div key={row} className="grid grid-cols-[1fr_42px_72px_76px] border-b border-slate-200 px-3 py-3 text-slate-300" style={{ backgroundColor: draft.printTemplate === 'striped' && row % 2 ? `${draft.printPrimaryColor}0A` : '#fff' }}><span>—</span><span className="text-center">—</span><span className="text-right">—</span><span className="text-right">—</span></div>)}
          </section>

          <section className="ml-auto mt-5 w-52 text-[8px]">{['Subtotal','VAT','TOTAL'].map((label,index) => <div key={label} className={`flex justify-between border-b px-3 py-2 ${index === 2 ? 'font-black' : ''}`} style={index === 2 ? { backgroundColor: `${draft.printPrimaryColor}0D`, color: draft.printPrimaryColor } : undefined}><span>{label}</span><span>—</span></div>)}</section>
          <p className="mt-8 border-t pt-3 text-[7px] text-slate-400">Payment instructions and document notes appear here only when entered.</p>
        </main>
        <footer className="absolute inset-x-9 bottom-5 flex items-end justify-between border-t pt-2 text-[6px] text-slate-400" style={{ borderColor: draft.printSecondaryColor }}><span>{draft.invoiceFooter || company.website || ''}</span><span>Page 1</span></footer>
      </article>
    </div>
  )
}

export function DocumentLayoutConfigurator({ company, updateCompany, showToast }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => toDraft(company))
  const selected = useMemo(() => DOCUMENT_LAYOUT_OPTIONS.find(option => option.id === normalizeDocumentLayout(company.printTemplate)), [company.printTemplate])

  useEffect(() => {
    if (open) setDraft(toDraft(company))
  }, [open, company])

  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }))

  const uploadLogo = async (file?: File) => {
    if (!file) return
    try {
      const dataUrl = await readGuardedImageAsDataUrl(file, { label: 'Company logo', maxBytes: 2 * 1024 * 1024, maxPixels: 12_000_000 })
      patch('logoUrl', await compressCompanyLogoDataUrl(dataUrl))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Company logo could not be validated', 'error')
    }
  }

  const save = () => {
    updateCompany({
      printTemplate: draft.printTemplate,
      printFont: draft.printFont,
      printBackground: draft.printBackground,
      printPrimaryColor: normalizeHexColor(draft.printPrimaryColor, '#1B2762'),
      printSecondaryColor: normalizeHexColor(draft.printSecondaryColor, '#00AEEF'),
      logoUrl: draft.logoUrl,
      address: draft.address.trim(),
      printTagline: draft.printTagline.trim(),
      invoiceFooter: draft.invoiceFooter.trim(),
      printPaperFormat: draft.printPaperFormat,
    })
    setOpen(false)
    showToast('Document layout configuration saved', 'success')
  }

  return (
    <>
      <div className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[12px] font-semibold text-gray-800">{selected?.label || 'Standard'} layout</p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
            Configure the template, font, colours, background, logo, address, tagline, footer, and paper format used by printed documents.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="btn-primary whitespace-nowrap">
          Configure Document Layout
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="document-layout-title">
          <div className="flex max-h-[94vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 id="document-layout-title" className="text-[16px] font-bold text-gray-900">Configure Document Layout</h2>
                <p className="mt-0.5 text-[11px] text-gray-500">Preview changes before applying them to every printed business document.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Discard and close" className="flex h-8 w-8 items-center justify-center rounded-lg text-xl text-gray-500 hover:bg-gray-100">×</button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-[390px_1fr]">
              <div className="space-y-5 border-r border-gray-200 p-5">
                <fieldset>
                  <legend className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">Layout</legend>
                  <div className="grid grid-cols-3 gap-2">
                    {DOCUMENT_LAYOUT_OPTIONS.map(option => (
                      <button key={option.id} type="button" onClick={() => patch('printTemplate', option.id)} className={`rounded-lg border-2 p-2 text-left transition ${draft.printTemplate === option.id ? 'border-[#1B2762] bg-[#1B2762]/5' : 'border-gray-200 hover:border-gray-300'}`}>
                        <LayoutThumbnail layout={option.id} primary={draft.printPrimaryColor} secondary={draft.printSecondaryColor} />
                        <span className="mt-1.5 block text-center text-[10px] font-semibold text-gray-700">{option.label}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-[11px] font-semibold text-gray-700">Font
                    <select value={draft.printFont} onChange={event => patch('printFont', event.target.value as DocumentFontId)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px]">
                      {DOCUMENT_FONT_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="text-[11px] font-semibold text-gray-700">Background
                    <select value={draft.printBackground} onChange={event => patch('printBackground', event.target.value as DocumentBackgroundId)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px]">
                      <option value="blank">Blank</option>
                      <option value="demo_logo">Company logo watermark</option>
                    </select>
                  </label>
                </div>

                <label className="block text-[11px] font-semibold text-gray-700">Company logo
                  <div className="mt-1 flex items-center gap-3 rounded-lg border border-gray-200 p-2">
                    <div className="flex h-12 w-20 items-center justify-center overflow-hidden rounded bg-gray-50">
                      {draft.logoUrl ? <img src={draft.logoUrl} alt="Company logo" className="max-h-11 max-w-[76px] object-contain" /> : <span className="text-[9px] text-gray-400">No logo</span>}
                    </div>
                    <label className="cursor-pointer rounded-lg border border-gray-200 px-3 py-2 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
                      Upload logo
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => { void uploadLogo(event.target.files?.[0]); event.target.value = '' }} />
                    </label>
                    {draft.logoUrl && <button type="button" onClick={() => patch('logoUrl', '')} className="text-[11px] font-semibold text-red-600">Remove</button>}
                  </div>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-[11px] font-semibold text-gray-700">Primary colour
                    <span className="mt-1 flex items-center gap-2 rounded-lg border border-gray-200 p-1.5">
                      <input type="color" value={draft.printPrimaryColor} onChange={event => patch('printPrimaryColor', event.target.value.toUpperCase())} className="h-8 w-10 cursor-pointer border-0 bg-transparent" />
                      <input value={draft.printPrimaryColor} onChange={event => patch('printPrimaryColor', event.target.value)} className="min-w-0 flex-1 text-[11px] outline-none" aria-label="Primary colour hex" />
                    </span>
                  </label>
                  <label className="text-[11px] font-semibold text-gray-700">Secondary colour
                    <span className="mt-1 flex items-center gap-2 rounded-lg border border-gray-200 p-1.5">
                      <input type="color" value={draft.printSecondaryColor} onChange={event => patch('printSecondaryColor', event.target.value.toUpperCase())} className="h-8 w-10 cursor-pointer border-0 bg-transparent" />
                      <input value={draft.printSecondaryColor} onChange={event => patch('printSecondaryColor', event.target.value)} className="min-w-0 flex-1 text-[11px] outline-none" aria-label="Secondary colour hex" />
                    </span>
                  </label>
                </div>

                <label className="block text-[11px] font-semibold text-gray-700">Company address
                  <textarea value={draft.address} onChange={event => patch('address', event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[12px] outline-none focus:border-[#1B2762]" />
                </label>
                <label className="block text-[11px] font-semibold text-gray-700">Tagline
                  <input value={draft.printTagline} onChange={event => patch('printTagline', event.target.value)} placeholder="Optional company tagline" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[12px] outline-none focus:border-[#1B2762]" />
                </label>
                <label className="block text-[11px] font-semibold text-gray-700">Footer
                  <textarea value={draft.invoiceFooter} onChange={event => patch('invoiceFooter', event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[12px] outline-none focus:border-[#1B2762]" />
                </label>
                <label className="block text-[11px] font-semibold text-gray-700">Paper format
                  <select value={draft.printPaperFormat} onChange={event => patch('printPaperFormat', event.target.value as DocumentPaperFormat)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px]">
                    <option value="a4">European A4</option>
                    <option value="letter">US Letter</option>
                  </select>
                </label>
              </div>

              <div className="min-h-[680px] p-5">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">PDF preview</div>
                <DocumentPreview draft={draft} company={company} />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
              <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Discard</button>
              <button type="button" onClick={save} className="btn-primary">Continue</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
