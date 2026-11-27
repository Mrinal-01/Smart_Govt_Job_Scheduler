import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { env } from '../../../config/env.js'

const run = promisify(execFile)

/** Replaceable OCR provider. Add a cloud OCR by implementing this interface. */
export interface OcrProvider {
  name: string
  available(): Promise<boolean>
  recognizePage(pdfPath: string, pageNumber: number): Promise<string>
}

async function hasBinary(bin: string, args: string[]) {
  try {
    await run(bin, args, { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/** Poppler `pdftoppm` renders the page; Tesseract CLI recognizes it. Both must be installed. */
export class TesseractCliProvider implements OcrProvider {
  readonly name = 'tesseract-cli'
  private cached: boolean | null = null

  async available() {
    if (this.cached === null) {
      this.cached = (await hasBinary('pdftoppm', ['-v'])) && (await hasBinary('tesseract', ['--version']))
    }
    return this.cached
  }

  async recognizePage(pdfPath: string, pageNumber: number) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studyos-ocr-'))
    try {
      const prefix = path.join(dir, 'page')
      await run('pdftoppm', ['-f', String(pageNumber), '-l', String(pageNumber), '-r', '300', '-gray', '-png', '-singlefile', pdfPath, prefix], {
        timeout: 60_000
      })
      const { stdout } = await run('tesseract', [`${prefix}.png`, 'stdout', '-l', env.OCR_LANG, '--psm', '6'], {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024
      })
      return stdout
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }
}

class NoOcrProvider implements OcrProvider {
  readonly name = 'none'
  async available() {
    return false
  }
  async recognizePage(): Promise<string> {
    throw new Error('OCR is not available')
  }
}

const provider: OcrProvider = env.OCR_PROVIDER === 'none' ? new NoOcrProvider() : new TesseractCliProvider()

export const getOcrProvider = () => provider
