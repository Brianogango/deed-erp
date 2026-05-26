'use client'

import { useState } from 'react'
import { Fa } from '@/components/icons'
import { faPaperPlane, faSync, faComments } from '@fortawesome/free-solid-svg-icons'

interface MessageThreadProps {
  repairRef: string
  staffName: string
}

export default function MessageThread({ repairRef, staffName }: MessageThreadProps) {
  const [message, setMessage] = useState('')

  const handleSend = () => {
    if (!message.trim()) return
    // Logic for sending message would go here
    setMessage('')
  }

  return (
    <div className="card p-5 border-l-4 border-l-blue-500 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
            <Fa icon={faComments} className="text-xs" />
          </div>
          <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Customer Chat</h3>
        </div>
        <button className="text-[9px] font-black text-slate-400 uppercase tracking-widest hover:text-blue-600 flex items-center gap-1 transition-all">
          <Fa icon={faSync} className="text-[8px]" /> Refresh
        </button>
      </div>

      <div className="flex flex-col items-center justify-center py-12 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 text-slate-400 gap-2 mb-4">
        <Fa icon={faComments} className="text-2xl opacity-20" />
        <p className="text-[11px] font-medium">No messages yet</p>
        <p className="text-[9px] uppercase tracking-widest opacity-60">Reply to customer below</p>
      </div>

      <div className="relative">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Reply to customer..."
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all pr-12"
        />
        <button 
          onClick={handleSend}
          disabled={!message.trim()}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-blue-600 text-white disabled:bg-slate-300 transition-all"
        >
          <Fa icon={faPaperPlane} className="text-[10px]" />
        </button>
      </div>
    </div>
  )
}
