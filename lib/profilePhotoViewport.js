export const DEFAULT_PHOTO_VIEWPORT = Object.freeze({ x: 0, y: 0, scale: 1, rotation: 0, brightness: 100, contrast: 100, saturation: 100 })
const limits = { x: [-100, 100], y: [-100, 100], scale: [0.5, 3], rotation: [0, 360], brightness: [50, 150], contrast: [50, 150], saturation: [0, 200] }
export function normalizePhotoViewport(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid photo viewport')
  return Object.fromEntries(Object.entries(limits).map(([key, [min, max]]) => {
    const number = value[key] === undefined ? DEFAULT_PHOTO_VIEWPORT[key] : value[key]
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max) throw new Error(`Invalid photo viewport ${key}`)
    return [key, number]
  }))
}
export function photoViewportStyle(value) {
  let v
  try { v = normalizePhotoViewport(value || {}) } catch { v = DEFAULT_PHOTO_VIEWPORT }
  return { transform: `translate(${v.x}%, ${v.y}%) scale(${v.scale}) rotate(${v.rotation}deg)`, transformOrigin: 'center', filter: `brightness(${v.brightness}%) contrast(${v.contrast}%) saturate(${v.saturation}%)` }
}
