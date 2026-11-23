'use client'

import { useEffect, useRef, useState } from 'react'
import { readGuardedImageAsDataUrl } from '@/lib/client-image-guard'
import { useFinanceStore } from '@/lib/store'

type Photo = { id: string; url: string; name: string; stage: 'sent' | 'returned'; uploaded_at: string; by?: string }

/**
 * Photos of the machine when it left for the vendor and when it came back:
 * proof of the state it was handed over in. Staff only (never on the portal).
 */
export function OutsourcePhotos({ jobId, canAdd, returned }: { jobId: string; canAdd: boolean; returned: boolean }) {
  const { showToast } = useFinanceStore()
  const [photos, setPhotos] = useState<Photo[] | null>(null)
  const [busy, setBusy] = useState<'sent' | 'returned' | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<'sent' | 'returned'>('sent')

  useEffect(() => {
    let alive = true
    fetch(`/api/outsource-photos/${encodeURIComponent(jobId)}`)
      .then(r => (r.ok ? r.json() : { photos: [] }))
      .then(d => { if (alive) setPhotos(Array.isArray(d.photos) ? d.photos : []) })
      .catch(() => { if (alive) setPhotos([]) })
    return () => { alive = false }
  }, [jobId])

  function pick(stage: 'sent' | 'returned') {
    stageRef.current = stage
    inputRef.current?.click()
  }

  async function upload(files: FileList | null) {
    const list = Array.from(files ?? [])
    if (!list.length) return
    const stage = stageRef.current
    setBusy(stage)
    try {
      for (const file of list) {
        const url = await readGuardedImageAsDataUrl(file)
        const res = await fetch(`/api/outsource-photos/${encodeURIComponent(jobId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, name: file.name, stage }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { showToast(data.error || 'Could not save the photo', 'error'); break }
        setPhotos(p => [...(p ?? []), data.photo])
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not read the photo', 'error')
    } finally {
      setBusy(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const group = (stage: 'sent' | 'returned', title: string, show: boolean) => {
    const rows = (photos ?? []).filter(p => p.stage === stage)
    if (!show && rows.length === 0) return null
    return (
      <section className="outsource-photos__group">
        <header>
          <h4>{title}</h4>
          {canAdd && show && (
            <button type="button" className="outsource-act" disabled={busy !== null} onClick={() => pick(stage)}>
              {busy === stage ? 'Saving…' : '+ Add photo'}
            </button>
          )}
        </header>
        {rows.length === 0
          ? <p className="outsource-photos__empty">No photos yet.</p>
          : (
            <div className="outsource-photos__grid">
              {rows.map(p => (
                <a key={p.id} href={p.url} target="_blank" rel="noreferrer" title={`${p.name}${p.by ? ` · ${p.by}` : ''}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.name || 'Machine photo'} loading="lazy" />
                </a>
              ))}
            </div>
          )}
      </section>
    )
  }

  if (photos === null) return <p className="outsource-photos__empty">Loading photos…</p>
  return (
    <div className="outsource-photos">
      <input ref={inputRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={e => upload(e.target.files)} />
      {group('sent', 'When it left', true)}
      {group('returned', 'When it came back', returned)}
    </div>
  )
}
