import { PDFDocument, StandardFonts } from 'pdf-lib'

/** Builds a real text-layer PDF; each inner array is one page of lines. */
export async function makePdf(pages: string[][]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const lines of pages) {
    const page = doc.addPage([595, 842])
    lines.forEach((line, i) => page.drawText(line, { x: 50, y: 800 - i * 18, size: 11, font }))
  }
  return Buffer.from(await doc.save())
}

/** A page with no text layer at all (what a scanned page looks like to the extractor). */
export async function makeBlankPdf(pageCount = 1): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i += 1) doc.addPage([595, 842])
  return Buffer.from(await doc.save())
}

export const SCIENCE_PAPER = [
  [
    'Physical Science Mock Paper',
    '1. What is the SI unit of force?',
    '(a) Joule (b) Newton (c) Watt (d) Pascal',
    '2. Which quantity is a vector?',
    '(a) Speed (b) Mass (c) Velocity (d) Time',
    '3. The unit of power is',
    '(a) Watt (b) Joule (c) Newton (d) Volt'
  ],
  [
    '4. Ohm is the unit of',
    '(a) Current (b) Resistance (c) Charge (d) Power',
    '5. Describe the working of a transformer.',
    'Answer Key',
    '1. (b) 2. (c) 3. (a) 4. (b)'
  ]
]
