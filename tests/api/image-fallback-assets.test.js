import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { DEFAULT_AVATAR_SRC, DEFAULT_IMAGE_SRC } from '@/lib/imageFallback'

describe('deployed image fallbacks', () => {
  test.each([DEFAULT_AVATAR_SRC, DEFAULT_IMAGE_SRC])('%s is a decodable non-empty image', async (source) => {
    const bytes = fs.readFileSync(path.join(process.cwd(), 'public', source))
    expect(bytes.length).toBeGreaterThan(0)
    const metadata = await sharp(bytes).metadata()
    expect(metadata.width).toBeGreaterThan(0)
    expect(metadata.height).toBeGreaterThan(0)
  })
})
