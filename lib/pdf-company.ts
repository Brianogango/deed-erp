/** Company details and logo as the PDF builders expect them. */
export function pdfCompany<C extends Record<string, any>>(co: C, logo?: { dataUrl?: string; width?: number; height?: number; format?: 'PNG' | 'JPEG' } | null) {
  return {
    name: co.name,
    address: co.address,
    city: co.city,
    phone: co.phone,
    email: co.email,
    website: co.website,
    kraPin: co.kraPin,
    currency: co.currency,
    mpesaPaybill: co.mpesaPaybill,
    mpesaAccount: co.mpesaAccount,
    printTemplate: co.printTemplate,
    printFont: co.printFont,
    printBackground: co.printBackground,
    printPrimaryColor: co.printPrimaryColor,
    printSecondaryColor: co.printSecondaryColor,
    printTagline: co.printTagline,
    printPaperFormat: co.printPaperFormat,
    invoiceFooter: co.invoiceFooter,
    logoDataUrl: logo?.dataUrl,
    logoWidth: logo?.width,
    logoHeight: logo?.height,
    logoFormat: logo?.format,
  }
}
