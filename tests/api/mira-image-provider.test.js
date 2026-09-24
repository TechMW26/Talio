import sharp from 'sharp'
import { DEFAULT_IMAGE_MODEL, generatePollinationsImage } from '@/lib/ai/providers/pollinationsImageProvider'

const originalFetch = global.fetch
const originalKey = process.env.POLLINATIONS_API_KEY
const originalModel = process.env.POLLINATIONS_IMAGE_MODEL
beforeEach(() => {
  process.env.POLLINATIONS_API_KEY = 'test-only'
  delete process.env.POLLINATIONS_IMAGE_MODEL
})
afterEach(() => {
  global.fetch = originalFetch
  for (const [key, value] of [['POLLINATIONS_API_KEY', originalKey], ['POLLINATIONS_IMAGE_MODEL', originalModel]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value
  }
})

test('uses Turbo at 1024px without forcing slow high-quality generation', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer()
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] })))
  const signal = new AbortController().signal
  const image = await generatePollinationsImage('An orange', signal)
  const options = fetch.mock.calls[0][1]
  expect(DEFAULT_IMAGE_MODEL).toBe('tongyi-mai/z-image-turbo')
  expect(JSON.parse(options.body)).toEqual({ model: DEFAULT_IMAGE_MODEL, prompt: 'An orange', n: 1, size: '1024x1024', response_format: 'b64_json' })
  expect(options.signal).toBe(signal)
  expect(image.contentType).toBe('image/png')
  expect((await sharp(image.buffer).metadata()).format).toBe('png')
})

test('retains an explicit administrator model override and reports provider failure without retries', async () => {
  process.env.POLLINATIONS_IMAGE_MODEL = 'prunaai/p-image'
  global.fetch = jest.fn(async () => new Response('unavailable', { status: 503 }))
  await expect(generatePollinationsImage('An orange')).rejects.toThrow('temporarily unavailable')
  expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('prunaai/p-image')
  expect(fetch).toHaveBeenCalledTimes(1)
})
