'use client'

const TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/svg+xml'])

export function validateCompanyLogo(file) {
  if (!file) return
  const type = String(file.type || '').toLowerCase()
  if (!TYPES.has(type) && !(!type && /\.(svg|webp|png|jpe?g|gif)$/i.test(file.name))) throw new Error('Choose an SVG, WebP, PNG, JPG/JPEG or GIF logo.')
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Choose a non-empty logo smaller than 10 MB.')
}

// Decode SVG in an image context (scripts cannot run), and upload pixels only.
// A bounded output also keeps uploads below Vercel's function body limit.
export async function prepareCompanyLogo(file, signal) {
  validateCompanyLogo(file)
  const url = URL.createObjectURL(file)
  const image = new Image()
  let abort
  try {
    await new Promise((resolve, reject) => {
      abort = () => { image.src = ''; reject(new Error('Logo preparation cancelled')) }
      image.onload = resolve
      image.onerror = () => reject(new Error('This logo could not be read. Please choose a valid image.'))
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) return abort()
      image.src = url
    })
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    if (!width || !height) throw new Error('The logo must have a valid width and height.')
    const scale = Math.min(1, 1024 / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image processing is unavailable in this browser.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not prepare the logo.')), 'image/webp', 0.9))
    if (signal?.aborted) throw new Error('Logo preparation cancelled')
    if (blob.size > 3 * 1024 * 1024) throw new Error('The processed logo is too large. Please choose a simpler or smaller image.')
    return new File([blob], `company-logo.${blob.type === 'image/webp' ? 'webp' : 'png'}`, { type: blob.type })
  } finally {
    signal?.removeEventListener('abort', abort)
    image.onload = null
    image.onerror = null
    URL.revokeObjectURL(url)
  }
}
