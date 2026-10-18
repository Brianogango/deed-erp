/** A CRM email: the rep's own words, plain, with their name under it. */

const escape = (s: string) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

export function crmEmailText(body: string, rep: { name: string; email?: string }) {
  return `${body.trim()}\n\n--\n${rep.name}\nDeed Digital Solutions${rep.email ? `\n${rep.email}` : ''}\n`
}

export function crmEmailHtml(body: string, rep: { name: string; email?: string }) {
  const paragraphs = body.trim().split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 12px">${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2933">${paragraphs}`
    + `<p style="margin:20px 0 0;color:#52606d">--<br>${escape(rep.name)}<br>Deed Digital Solutions`
    + `${rep.email ? `<br><a href="mailto:${escape(rep.email)}">${escape(rep.email)}</a>` : ''}</p></div>`
}
