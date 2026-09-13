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

function LayoutThumbnail({ layout, primary, secondary }: {
  layout: DocumentLayoutId
  primary: string
  secondary: string
}) {
  return (
    <span className="block aspect-[1.414/1] overflow-hidden rounded border border-gray-200 bg-white shadow-sm">
      <span
        className="block h-3"
        style={{
          background: layout === 'wave'
            ? `linear-gradient(160deg, ${primary} 0 48%, ${secondary} 49% 65%, transparent 66%)`
            : layout === 'bubble'
              ? `radial-gradient(circle at 90% 0, ${secondary} 0 38%, transparent 39%)`
              : layout === 'folder'
                ? `linear-gradient(110deg, ${primary} 0 28%, ${secondary} 29% 100%)`
                : layout === 'bold' ? primary : 'white',
        }}
      />
      <span className="block space-y-1 px-2 py-1.5">
        <span className="block h-1.5 w-10 rounded" style={{ backgroundColor: primary }} />
        <span className={`block h-2.5 rounded ${layout === 'boxed' ? 'border bg-white' : 'bg-gray-100'}`} style={layout === 'boxed' ? { borderColor: primary } : undefined} />
        {[0, 1, 2].map(row => (
          <span
            key={row}
            className="block h-1.5 rounded"
            style={{ backgroundColor: layout === 'striped' && row % 2 ? `${primary}22` : '#F1F5F9' }}
          />
        ))}
      </span>
    </span>
  )
}

function DocumentPreview({ draft, company }: { draft: Draft; company: CompanySettings }) {
  const paperClass = draft.printPaperFormat === 'letter' ? 'aspect-[8.5/11]' : 'aspect-[210/297]'
  const lineFill = draft.printTemplate === 'striped' ? `${draft.printPrimaryColor}12` : '#FFFFFF'
  return (
    <div className="flex min-h-[620px] items-start justify-center overflow-auto rounded-xl bg-gray-100 p-5">
      <div
        className={`relative w-full max-w-[520px] overflow-hidden bg-white shadow-xl ${paperClass}`}
        style={{ fontFamily: fontFamily[draft.printFont] }}
      >
        {draft.printBackground === 'demo_logo' && draft.logoUrl && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.045]">
            <img src={draft.logoUrl} alt="" className="w-2/3 object-contain" />
          </div>
        )}
        <div
          className={`relative h-20 px-6 py-4 ${draft.printTemplate === 'boxed' ? 'm-4 rounded border-2' : ''}`}
          style={{
            borderColor: draft.printPrimaryColor,
            color: draft.printTemplate === 'bold' ? '#FFFFFF' : '#111827',
            background: draft.printTemplate === 'bold'
              ? draft.printPrimaryColor
              : draft.printTemplate === 'wave'
                ? `linear-gradient(165deg, ${draft.printPrimaryColor} 0 56%, ${draft.printSecondaryColor} 57% 68%, #fff 69%)`
                : draft.printTemplate === 'bubble'
                  ? `radial-gradient(circle at 100% 0, ${draft.printSecondaryColor} 0 34%, transparent 35%)`
                  : draft.printTemplate === 'folder'
                    ? `linear-gradient(115deg, ${draft.printPrimaryColor} 0 34%, ${draft.printSecondaryColor} 35% 100%)`
                    : '#FFFFFF',
          }}
        >
          <div className="flex items-start justify-between">
            {draft.logoUrl
              ? <img src={draft.logoUrl} alt="Company logo preview" className="h-9 max-w-[130px] object-contain" />
              : company.name && <span className="text-lg font-black" style={{ color: draft.printTemplate === 'bold' ? '#fff' : draft.printPrimaryColor }}>{company.name}</span>}
            <span className="max-w-[190px] whitespace-pre-line text-right text-[8px] leading-relaxed">
              {[draft.address, company.phone, company.email].filter(Boolean).join('\n')}
            </span>
          </div>
        </div>
        <div className="relative px-7 pt-4 text-[9px] text-gray-700">
          <div className="mb-4 flex items-end justify-between border-b pb-3" style={{ borderColor: draft.printSecondaryColor }}>
            <div className="h-5 w-28 rounded" style={{ backgroundColor: `${draft.printPrimaryColor}18` }} />
            <div className="space-y-1">
              <div className="h-2 w-24 rounded bg-gray-100" />
              <div className="h-2 w-20 rounded bg-gray-100" />
            </div>
          </div>
          {draft.printTagline && <div className="mb-3 text-[10px] italic" style={{ color: draft.printSecondaryColor }}>{draft.printTagline}</div>}
          <div className={`mb-4 grid grid-cols-2 gap-4 p-3 ${draft.printTemplate === 'boxed' ? 'rounded border' : draft.printTemplate === 'bubble' ? 'rounded-2xl' : ''}`} style={{ borderColor: draft.printPrimaryColor, backgroundColor: draft.printTemplate === 'bubble' ? `${draft.printSecondaryColor}10` : undefined }}>
            {[0, 1].map(column => (
              <div key={column} className="space-y-1.5">
                <div className="h-2 w-20 rounded" style={{ backgroundColor: `${draft.printPrimaryColor}24` }} />
                <div className="h-2 w-full rounded bg-gray-100" />
                <div className="h-2 w-3/4 rounded bg-gray-100" />
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded border border-gray-200">
            <div className="grid grid-cols-[1fr_55px_80px] px-3 py-2" style={{ backgroundColor: draft.printPrimaryColor }}>
              <span className="h-2 w-24 rounded bg-white/70" /><span className="h-2 w-7 rounded bg-white/70" /><span className="ml-auto h-2 w-12 rounded bg-white/70" />
            </div>
            {[0, 1, 2].map(row => (
              <div key={row} className="grid grid-cols-[1fr_55px_80px] border-t border-gray-100 px-3 py-2" style={{ backgroundColor: row % 2 ? lineFill : '#fff' }}>
                <span className="h-2 w-2/3 rounded bg-gray-100" /><span className="h-2 w-5 rounded bg-gray-100" /><span className="ml-auto h-2 w-14 rounded bg-gray-100" />
              </div>
            ))}
          </div>
          <div className="ml-auto mt-4 w-48 space-y-2">
            {[0, 1, 2].map(row => <div key={row} className="ml-auto h-2 rounded bg-gray-100" style={{ width: row === 2 ? '100%' : '78%' }} />)}
          </div>
          <p className="mt-8 text-center text-[9px] text-gray-400">Document values appear only after they are entered on the document.</p>
        </div>
        {draft.invoiceFooter && (
          <div className="absolute inset-x-7 bottom-5 border-t pt-2 text-center text-[8px] text-gray-500" style={{ borderColor: draft.printSecondaryColor }}>
            {draft.invoiceFooter}
          </div>
        )}
      </div>
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

            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-[430px_1fr]">
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
                      <option value="demo_logo">Demo logo</option>
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
