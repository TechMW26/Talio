import sharp from 'sharp'

export const DEFAULT_IMAGE_MODEL = 'tongyi-mai/z-image-turbo'

export async function generatePollinationsImage(prompt, signal) {
  const key = process.env.POLLINATIONS_API_KEY?.trim()
  if (!key) throw new Error('Image generation is not configured.')
  const model = process.env.POLLINATIONS_IMAGE_MODEL || DEFAULT_IMAGE_MODEL
  const response = await fetch('https://gen.pollinations.ai/v1/images/generations', {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(response.status === 402 ? 'Image generation credits are unavailable. Contact your administrator.' : 'Image generation is temporarily unavailable. Please try again later.')
  }
  const reader = response.body.getReader()
  const chunks = []; let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 16 * 1024 * 1024) throw new Error('Generated image is too large.')
      chunks.push(Buffer.from(value))
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const encoded = JSON.parse(Buffer.concat(chunks).toString()).data?.[0]?.b64_json
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(encoded)) throw new Error('The image provider returned an invalid image.')
  // Decode and re-encode rather than serving untrusted HTML/SVG or metadata.
  const buffer = await sharp(Buffer.from(encoded, 'base64'), { limitInputPixels: 16777216 }).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 3 }).toBuffer()
  if (buffer.length > 8 * 1024 * 1024) throw new Error('Generated image is too large.')
  return { buffer, model, contentType: 'image/png' }
}
