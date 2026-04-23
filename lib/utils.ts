import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const uid = () => Math.random().toString(36).slice(2, 9)
export const now = () => new Date().toISOString().slice(0, 10)
export const seq = (prefix: string) => `${prefix}/${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`
export const addDays = (d: string, n: number) => {
  const dt = new Date(d)
  dt.setDate(dt.getDate() + n)
  return dt.toISOString().slice(0, 10)
}

