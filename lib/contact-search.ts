export type PickerContact = {
  id: string
  name: string
  phone?: string
  email?: string
  mobile?: string
  isCustomer?: boolean
  isArchived?: boolean
}

export function customerPickerItems(contacts: PickerContact[]) {
  return contacts
    .filter(contact => contact.isCustomer !== false && !contact.isArchived)
    .map(contact => ({
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      mobile: contact.mobile,
      isCustomer: contact.isCustomer,
    }))
    .sort((a, b) => {
      const customerRank = (a.isCustomer ? 0 : 1) - (b.isCustomer ? 0 : 1)
      if (customerRank !== 0) return customerRank
      return a.name.localeCompare(b.name)
    })
}
