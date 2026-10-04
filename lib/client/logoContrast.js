// Small, local-only sample: never upload the logo or alter its brand colours.
export const LOGO_BACKGROUND_FALLBACK = '#767676'
const backgrounds = ['#f8fafc', '#18202b', LOGO_BACKGROUND_FALLBACK]
const linear = channel => {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}
const luminance = (r, g, b) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)

export function chooseLogoBackground(pixels) {
  let best = LOGO_BACKGROUND_FALLBACK, bestScore = -Infinity
  for (const background of backgrounds) {
    const rgb = [1, 3, 5].map(index => parseInt(background.slice(index, index + 2), 16))
    const base = luminance(...rgb)
    let score = 0, weight = 0
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3] / 255
      if (alpha < 0.1) continue // Ignore transparent padding and near-invisible edges.
      const ink = luminance(...rgb.map((channel, j) => pixels[i + j] * alpha + channel * (1 - alpha)))
      const contrast = (Math.max(ink, base) + 0.05) / (Math.min(ink, base) + 0.05)
      // Cap high contrast so a bright accent cannot outweigh illegible lettering.
      score += alpha * Math.log(Math.min(contrast, 7))
      weight += alpha
    }
    if (weight && score / weight > bestScore) { bestScore = score / weight; best = background }
  }
  return best
}

export function sampleLogoBackground(image) {
  try {
    if (!image.naturalWidth || !image.naturalHeight) return LOGO_BACKGROUND_FALLBACK
    const scale = Math.min(1, 96 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return LOGO_BACKGROUND_FALLBACK
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return chooseLogoBackground(context.getImageData(0, 0, canvas.width, canvas.height).data)
  } catch {
    // Cross-origin images without CORS can render but cannot be sampled.
    return LOGO_BACKGROUND_FALLBACK
  }
}
