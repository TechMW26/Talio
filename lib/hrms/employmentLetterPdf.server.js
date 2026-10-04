import { jsPDF } from 'jspdf'
import sharp from 'sharp'
import { getImage, getImageInfo } from '@/lib/mediaStorage'
import { buildTenantRootPrefix, getTenantBlob } from '@/lib/platform/blobStorage.server'
import { employmentLetterParagraphs } from './employmentLetter'

const MAX_LOGO_BYTES = 5 * 1024 * 1024
export async function loadEmploymentLetterLogo(source, tenantId) {
  if (!source) throw new Error('Upload the company logo in company settings before issuing a letter')
  let buffer
  const url = new URL(source, 'https://talio.local')
  if (/^data:image\/(png|jpeg|webp);base64,/i.test(source)) {
    buffer = Buffer.from(source.split(',')[1], 'base64')
  } else if (/^\/api\/images\/[a-f\d]{24}$/i.test(url.pathname)) {
    const id = url.pathname.split('/').pop()
    const info = await getImageInfo(id, { databaseName: tenantId })
    if (!info || info.length > MAX_LOGO_BYTES) throw new Error('Company logo is missing or exceeds 5 MB')
    buffer = await getImage(id, { databaseName: tenantId })
  } else {
    const pathname = decodeURIComponent(url.pathname.replace(/^\/api\/files\//, '').replace(/^\//, ''))
    if (!pathname.startsWith(`${buildTenantRootPrefix(tenantId)}/`) || pathname.includes('..')) {
      throw new Error('Please upload the company logo through company settings to use it on letters')
    }
    const result = await getTenantBlob(pathname)
    if (!result?.stream || result.blob.size > MAX_LOGO_BYTES) throw new Error('Unable to load the uploaded company logo')
    buffer = Buffer.from(await new Response(result.stream).arrayBuffer())
  }
  if (!buffer?.length || buffer.length > MAX_LOGO_BYTES) throw new Error('Company logo must be an image under 5 MB')
  const { data, info } = await sharp(buffer, { limitInputPixels: 20_000_000 }).resize(600, 240, { fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true })
  return { data: data.toString('base64'), width: info.width, height: info.height }
}

export function generateEmploymentLetterPdf({ kind, fields, logo, reference, title, paragraphs }) {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), margin = 48, width = W - 2 * margin
  let y
  const header = () => {
    pdf.setFillColor(22, 43, 53); pdf.rect(0, 0, W, 8, 'F')
    if (logo) {
      const scale = Math.min(90 / logo.width, 55 / logo.height)
      pdf.addImage(`data:image/png;base64,${logo.data}`, 'PNG', margin, 30, logo.width * scale, logo.height * scale)
    }
    pdf.setTextColor(22, 43, 53); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15)
    const names = pdf.splitTextToSize(fields.companyName, width - 115)
    pdf.text(names, margin + 115, 43)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(83, 96, 104)
    const address = pdf.splitTextToSize(fields.companyAddress, width - 115)
    pdf.text(address, margin + 115, 48 + names.length * 17, { lineHeightFactor: 1.3 })
    y = Math.max(104, 55 + names.length * 17 + address.length * 11)
    pdf.setDrawColor(191, 208, 214); pdf.line(margin, y, W - margin, y); y += 28
  }
  header()
  const space = height => { if (y + height > H - 65) { pdf.addPage(); header() } }
  const paragraph = (text, { bold = false, size = 10.5, after = 8 } = {}) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(31, 41, 55)
    const lines = pdf.splitTextToSize(String(text || '').replace(/[\u2010-\u2015]/g, '-'), width)
    // Keep short blocks (especially the signatory) together across page breaks.
    if (lines.length <= 5) space(lines.length * size * 1.35)
    for (const line of lines) { space(size * 1.35); pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(31, 41, 55); pdf.text(line, margin, y); y += size * 1.35 }
    y += after
  }
  paragraph(title || (kind === 'offer' ? 'OFFER OF EMPLOYMENT' : 'APPOINTMENT LETTER'), { bold: true, size: 17, after: 8 })
  paragraph(`Reference: ${reference}    |    Issued: ${fields.issueDate}`, { size: 9, after: 14 })
  paragraph(`${fields.employeeName} (${fields.employeeCode})\n${fields.employeeAddress}`, { size: 10, after: 17 })
  for (const entry of (paragraphs || employmentLetterParagraphs(kind, fields))) {
    space(entry.title ? 50 : 28)
    if (entry.title) paragraph(entry.title, { bold: true, size: 10.5, after: 1 })
    paragraph(entry.text)
  }
  const pages = pdf.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page); pdf.setDrawColor(215, 223, 227); pdf.line(margin, H - 43, W - margin, H - 43)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(95, 106, 114)
    pdf.text(reference, margin, H - 28); pdf.text(`Page ${page} of ${pages}`, W - margin, H - 28, { align: 'right' })
  }
  return Buffer.from(pdf.output('arraybuffer'))
}
