import sharp from 'sharp'
import path from 'node:path'

test.each(['1f44d', '1f44f', '2764', '1f602', '1f62e', '1f389'])('reaction %s is a valid bundled PNG', async (code) => {
  const metadata = await sharp(path.join(process.cwd(), 'public/emojis/twemoji', `${code}.png`)).metadata()
  expect(metadata.format).toBe('png')
  expect(metadata.width).toBe(72)
  expect(metadata.height).toBe(72)
})
