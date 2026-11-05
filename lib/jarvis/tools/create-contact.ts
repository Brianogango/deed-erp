import 'server-only'

import { z } from 'zod'
import prisma from '@/lib/prisma'
import { findExistingContact, upsertContact, withoutCreditTerms, type ContactInput } from '@/lib/contact-prisma'
import { kraPinWarning } from '@/lib/contacts/kra-pin'
import type { ConfirmPreview, ConfirmResult, ToolDefinition } from '../types'

const inputSchema = z.object({
  type: z.enum(['company', 'individual']),
  name: z.string().trim().min(2).max(200),
  isCustomer: z.boolean().optional(),
  isVendor: z.boolean().optional(),
  email: z.string().trim().max(150).optional(),
  phone: z.string().trim().max(20).optional(),
  kraPin: z.string().trim().max(20).optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(100).optional(),
  country: z.string().trim().max(100).optional(),
  companyName: z.string().trim().max(200).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
})
type Input = z.infer<typeof inputSchema>

const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined)

function toContactInput(i: Input): ContactInput {
  return {
    type: i.type,
    name: i.name,
    isCustomer: i.isCustomer ?? !i.isVendor,
    isVendor: i.isVendor ?? false,
    email: clean(i.email) ?? '',
    phone: clean(i.phone) ?? '',
    vatNumber: clean(i.kraPin)?.toUpperCase(),
    address: clean(i.address) ?? '',
    city: clean(i.city),
    country: clean(i.country) ?? 'Kenya',
    jobTitle: i.type === 'individual' ? clean(i.jobTitle) : undefined,
    notes: clean(i.notes),
    tags: [],
  }
}

/** Contacts whose name is close to this one, so the person can spot a duplicate. */
async function similarContacts(name: string) {
  const words = name.split(/\s+/).filter(w => w.length >= 3).slice(0, 3)
  if (!words.length) return []
  return prisma.client.findMany({
    where: { AND: words.map(w => ({ OR: [{ name: { contains: w, mode: 'insensitive' as const } }, { companyName: { contains: w, mode: 'insensitive' as const } }] })) },
    take: 5,
    select: { id: true, name: true, clientNumber: true, phone: true, email: true, isCustomer: true, isVendor: true },
  })
}

export const createContactTool: ToolDefinition = {
  name: 'create_contact',
  description:
    'Add a new customer or vendor contact. Search first (search_customers / search_vendors) — if the contact already exists, use it instead. ' +
    'This only prepares a card: the user confirms it with the Confirm button before anything is saved. ' +
    'Ask for the name and whether it is a company or a person if you cannot tell; everything else is optional.',
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['company', 'individual'], description: 'company or individual (a person)' },
      name: { type: 'string', description: 'Company name, or the person\'s full name' },
      isCustomer: { type: 'boolean', description: 'Buys from us (default true unless a vendor)' },
      isVendor: { type: 'boolean', description: 'Supplies to us' },
      email: { type: 'string' },
      phone: { type: 'string', description: 'e.g. +254 712 345 678' },
      kraPin: { type: 'string', description: 'KRA PIN, e.g. P051234567X' },
      address: { type: 'string', description: 'Street / building / area' },
      city: { type: 'string' },
      country: { type: 'string', description: 'Default Kenya' },
      jobTitle: { type: 'string', description: 'Individuals only' },
      notes: { type: 'string' },
    },
    required: ['type', 'name'],
  },
  requiredModule: 'contacts',
  requiredPermission: null,
  mutates: true,
  run: async (_ctx, rawInput): Promise<ConfirmPreview | { ok: false; message: string; existing?: unknown }> => {
    const input = inputSchema.parse(rawInput)
    const contact = toContactInput(input)
    const exact = await findExistingContact(prisma, contact, { matchByName: true })
    if (exact) {
      return {
        ok: false,
        message: `${exact.name} (${exact.clientNumber}) already exists — use that contact instead of creating a new one.`,
        existing: { id: exact.id, name: exact.name, clientNumber: exact.clientNumber, isCustomer: exact.isCustomer, isVendor: exact.isVendor },
      }
    }
    const similar = await similarContacts(input.name)
    const role = [contact.isCustomer && 'Customer', contact.isVendor && 'Vendor'].filter(Boolean).join(' & ') || 'Contact'
    const pinWarning = contact.vatNumber ? kraPinWarning(contact.vatNumber, input.type) : null
    const warnings = [
      ...(similar.length ? [`Similar contacts already exist: ${similar.map(c => `${c.name} (${c.clientNumber})`).join(', ')}`] : []),
      ...(pinWarning ? [`KRA PIN: ${pinWarning}`] : []),
    ]
    const lines = [
      { label: 'Type', value: `${input.type === 'company' ? 'Company' : 'Individual'} · ${role}` },
      { label: 'Name', value: contact.name ?? '' },
      ...(contact.phone ? [{ label: 'Phone', value: contact.phone }] : []),
      ...(contact.email ? [{ label: 'Email', value: contact.email }] : []),
      ...(contact.vatNumber ? [{ label: 'KRA PIN', value: contact.vatNumber }] : []),
      ...(contact.address || contact.city ? [{ label: 'Address', value: [contact.address, contact.city, contact.country].filter(Boolean).join(', ') }] : []),
    ]
    return {
      ok: true,
      needsConfirmation: true,
      title: `New ${role.toLowerCase()} · ${contact.name}`,
      lines,
      warnings: warnings.length ? warnings : undefined,
      input,
      message: `A confirmation card for the new contact "${contact.name}" is shown to the user. Nothing is saved until they click Confirm.${warnings.length ? ` Point out: ${warnings.join('; ')}.` : ''}`,
    }
  },
  confirm: {
    execute: async (ctx, rawInput): Promise<ConfirmResult> => {
      const input = inputSchema.parse(rawInput)
      const contact = withoutCreditTerms(toContactInput(input), ctx.user.role)
      // Created by someone else since the card was shown: never overwrite it.
      const exact = await findExistingContact(prisma, contact, { matchByName: true })
      if (exact) return { ok: false, message: `${exact.name} (${exact.clientNumber}) already exists — nothing was created.` }
      const saved = await upsertContact(prisma, contact)
      if (typeof saved === 'string') return { ok: false, message: saved }
      const row = await prisma.client.findUnique({ where: { id: saved.contact.id }, select: { clientNumber: true } })
      const ref = row?.clientNumber
      return {
        ok: true,
        id: saved.contact.id,
        ref,
        href: '/contacts',
        message: `Contact ${saved.contact.name}${ref ? ` (${ref})` : ''} created.`,
      }
    },
  },
}
