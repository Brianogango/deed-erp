/**
 * Enhanced Email Templates for Deed ERP
 * Using a modern, clean, and professional design system.
 */

const DEED_PURPLE = '#1B2762';
const DEED_ACCENT = '#875BF7';
const TEXT_DARK = '#0F172A';
const TEXT_MUTED = '#64748B';
const BG_LIGHT = '#F8FAFC';
const BORDER_COLOR = '#E2E8F0';

/**
 * Base wrapper for all email templates to ensure consistent branding and layout.
 */
const baseTemplate = (content: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: ${TEXT_DARK}; margin: 0; padding: 0; background-color: ${BG_LIGHT}; }
    .wrapper { width: 100%; table-layout: fixed; background-color: ${BG_LIGHT}; padding-bottom: 40px; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; margin-top: 40px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); border: 1px solid ${BORDER_COLOR}; }
    .header { background-color: ${DEED_PURPLE}; padding: 32px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.025em; }
    .header p { color: rgba(255, 255, 255, 0.8); margin: 4px 0 0 0; font-size: 14px; }
    .content { padding: 40px 32px; }
    .footer { text-align: center; padding: 32px; font-size: 12px; color: ${TEXT_MUTED}; }
    .button { display: inline-block; padding: 12px 24px; background-color: ${DEED_PURPLE}; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; margin: 24px 0; }
    .info-box { background-color: ${BG_LIGHT}; border-radius: 8px; padding: 20px; border: 1px solid ${BORDER_COLOR}; margin: 24px 0; }
    .info-label { font-size: 12px; color: ${TEXT_MUTED}; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; margin-bottom: 4px; }
    .info-value { font-size: 16px; color: ${DEED_PURPLE}; font-weight: 600; font-family: 'Courier New', Courier, monospace; }
    .divider { height: 1px; background-color: ${BORDER_COLOR}; margin: 32px 0; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 12px; text-transform: uppercase; color: ${TEXT_MUTED}; padding: 12px 0; border-bottom: 2px solid ${BORDER_COLOR}; }
    td { padding: 16px 0; border-bottom: 1px solid ${BORDER_COLOR}; font-size: 14px; }
    .total-row td { border-bottom: none; padding-top: 24px; }
    .total-label { font-size: 14px; font-weight: 600; }
    .total-value { font-size: 20px; font-weight: 700; color: ${DEED_PURPLE}; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>Deed Technologies</h1>
        <p>Your Technology Partner</p>
      </div>
      <div class="content">
        ${content}
      </div>
      <div class="footer">
        <p>Deed Technologies Ltd · Sanlam House, Nairobi · <a href="https://deed.co.ke" style="color: ${DEED_PURPLE};">deed.co.ke</a></p>
        <p style="margin-top: 8px; opacity: 0.7;">This is an automated message from Deed ERP. Please do not reply directly to this email.</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

/**
 * Welcome / Credentials Email Template
 */
export const welcomeEmail = (name: string, username: string, temporaryPassword: string) => baseTemplate(`
  <h2 style="color: ${DEED_PURPLE}; margin-top: 0; font-size: 22px;">Welcome to the Team!</h2>
  <p>Hi ${name},</p>
  <p>Your Deed ERP account has been successfully created. You can now access the system using the credentials below.</p>
  
  <div class="info-box">
    <div style="margin-bottom: 16px;">
      <div class="info-label">Username</div>
      <div class="info-value">${username}</div>
    </div>
    <div>
      <div class="info-label">Temporary Password</div>
      <div class="info-value">${temporaryPassword}</div>
    </div>
  </div>
  
  <p>For security reasons, you will be required to change this password upon your first sign-in.</p>
  
  <a href="https://erp.deed.co.ke/login" class="button">Sign in to Deed ERP</a>
  
  <p style="font-size: 13px; color: ${TEXT_MUTED};">If you were not expecting this account, please contact the HR department immediately.</p>
  
  <div class="divider"></div>
  
  <p style="margin-bottom: 0;">Best regards,</p>
  <p style="margin-top: 4px; font-weight: 700; color: ${DEED_PURPLE};">HR Department<br>Deed Technologies Limited</p>
`);

/**
 * Password Reset Email Template
 */
export const passwordResetEmail = (name: string, username: string, temporaryPassword: string) => baseTemplate(`
  <h2 style="color: ${DEED_PURPLE}; margin-top: 0; font-size: 22px;">Credentials Reset</h2>
  <p>Hi ${name},</p>
  <p>Your Deed ERP credentials have been reset by an administrator. Please use the temporary credentials below to access your account.</p>
  
  <div class="info-box">
    <div style="margin-bottom: 16px;">
      <div class="info-label">Username</div>
      <div class="info-value">${username}</div>
    </div>
    <div>
      <div class="info-label">Temporary Password</div>
      <div class="info-value">${temporaryPassword}</div>
    </div>
  </div>
  
  <p>You will be prompted to set a new password after you sign in.</p>
  
  <a href="https://erp.deed.co.ke/login" class="button">Sign in to Deed ERP</a>
  
  <p style="font-size: 13px; color: ${TEXT_MUTED};">If you did not request this reset, please contact HR immediately to secure your account.</p>
  
  <div class="divider"></div>
  
  <p style="margin-bottom: 0;">Best regards,</p>
  <p style="margin-top: 4px; font-weight: 700; color: ${DEED_PURPLE};">HR Department<br>Deed Technologies Limited</p>
`);

/**
 * Quote Email Template
 */
export const quoteEmail = (quote: {
  ref: string
  companyName: string
  contactPersonName: string
  total: number
  validUntil: string
  ownerName?: string
  lines: Array<{ productName: string; qty: number; lineTotal: number }>
  kind?: 'initial' | 'update'
  pdfDownloadUrl?: string
}) => {
  const isUpdate = quote.kind === 'update'
  return baseTemplate(`
  <h2 style="color: ${DEED_PURPLE}; margin-top: 0; font-size: 22px;">${isUpdate ? 'Updated Quotation' : 'Quotation'}</h2>
  <p>Hello ${quote.contactPersonName},</p>
  <p>${isUpdate
    ? `Please find the <strong>updated quotation</strong> for <strong>${quote.companyName}</strong> below.`
    : `Please find our quotation for <strong>${quote.companyName}</strong> below.`}</p>
  
  <div style="margin: 32px 0;">
    <h3 style="font-size: 16px; color: ${DEED_PURPLE}; margin-bottom: 16px;">Quote Summary: ${quote.ref}${isUpdate ? ' (Updated)' : ''}</h3>
    <table>
      <thead>
        <tr>
          <th>Item Description</th>
          <th style="text-align: center;">Qty</th>
          <th style="text-align: right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${quote.lines.map(line => `
          <tr>
            <td>${line.productName}</td>
            <td style="text-align: center;">${line.qty}</td>
            <td style="text-align: right;">KES ${line.lineTotal.toLocaleString()}</td>
          </tr>
        `).join('')}
        <tr class="total-row">
          <td colspan="2" class="total-label" style="text-align: right; padding-right: 24px;">Total Amount (incl. VAT)</td>
          <td class="total-value" style="text-align: right;">KES ${quote.total.toLocaleString()}</td>
        </tr>
      </tbody>
    </table>
  </div>
  
  <p><strong>Valid until:</strong> ${quote.validUntil}</p>
  ${quote.pdfDownloadUrl
    ? `<p style="margin:24px 0;"><a href="${quote.pdfDownloadUrl}" class="button">Download PDF</a></p>`
    : `<p>The full quotation PDF is attached to this email — open the attachment to download.</p>`}
  
  <div class="divider"></div>
  
  <p style="margin-bottom: 0;">Best regards,</p>
  <p style="margin-top: 4px; font-weight: 700; color: ${DEED_PURPLE};">Sales<br>Deed Technologies Limited</p>
  <p style="margin-top: 4px; font-size: 13px; color: ${TEXT_MUTED};"><a href="mailto:sales@deed.co.ke" style="color: ${DEED_PURPLE};">sales@deed.co.ke</a></p>
`)}
