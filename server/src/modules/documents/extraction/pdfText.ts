import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// pdf.js 3.x legacy build (Node 18 compatible). Used for text extraction only.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js') as typeof import('pdfjs-dist')

export interface PdfPageText {
  pageNumber: number
  text: string
  hasImages: boolean
}

export class PdfError extends Error {
  constructor(
    readonly code: 'PDF_ENCRYPTED' | 'PDF_INVALID',
    message: string
  ) {
    super(message)
  }
}

interface TextItem {
  str: string
  transform: number[]
  width: number
  hasEOL?: boolean
}

async function open(data: Buffer) {
  try {
    return await pdfjs.getDocument({
      data: new Uint8Array(data),
      // Hardening: never evaluate font programs (mitigates CVE-2024-4367), no network, no fonts on disk.
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      disableRange: true,
      disableStream: true,
      verbosity: 0
    } as Parameters<typeof pdfjs.getDocument>[0]).promise
  } catch (err) {
    const name = (err as { name?: string }).name
    if (name === 'PasswordException') throw new PdfError('PDF_ENCRYPTED', 'This PDF is password protected. Remove the password and upload again.')
    throw new PdfError('PDF_INVALID', 'This file could not be read as a PDF.')
  }
}

export async function countPages(data: Buffer): Promise<number> {
  const doc = await open(data)
  const n = doc.numPages
  await doc.destroy()
  return n
}

/** Rebuilds reading-order lines from positioned text items (top→bottom, left→right). */
function itemsToText(items: TextItem[]): string {
  const rows: Array<{ y: number; parts: Array<{ x: number; str: string; w: number }> }> = []
  for (const item of items) {
    if (!item.str) continue
    const x = item.transform[4]
    const y = item.transform[5]
    let row = rows.find((r) => Math.abs(r.y - y) < 3)
    if (!row) {
      row = { y, parts: [] }
      rows.push(row)
    }
    row.parts.push({ x, str: item.str, w: item.width })
  }
  rows.sort((a, b) => b.y - a.y)
  return rows
    .map((row) => {
      row.parts.sort((a, b) => a.x - b.x)
      let line = ''
      let lastEnd = -Infinity
      for (const p of row.parts) {
        if (line && p.x - lastEnd > 1.5 && !line.endsWith(' ') && !p.str.startsWith(' ')) line += ' '
        line += p.str
        lastEnd = p.x + p.w
      }
      return line.replace(/[ \t]+/g, ' ').trimEnd()
    })
    .join('\n')
}

export async function extractPdfText(data: Buffer, onPage?: (page: number, total: number) => void): Promise<PdfPageText[]> {
  const doc = await open(data)
  const out: PdfPageText[] = []
  try {
    const imageOps = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject])
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      let hasImages = false
      try {
        const ops = await page.getOperatorList()
        hasImages = ops.fnArray.some((fn: number) => imageOps.has(fn))
      } catch {
        hasImages = false
      }
      out.push({ pageNumber: n, text: itemsToText(content.items as TextItem[]), hasImages })
      page.cleanup()
      onPage?.(n, doc.numPages)
    }
  } finally {
    await doc.destroy()
  }
  return out
}
