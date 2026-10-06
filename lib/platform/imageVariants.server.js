import { buildTenantBlobPath, getTenantBlob, uploadTenantBlob } from './blobStorage.server'

const SIZES = [128, 256, 512, 1024]
const options = (identity, size) => ({ tenantId: identity.tenantId, category: 'images', ownerId: identity.dataset, id: identity.id, filename: `thumb-v1-${identity.sha256}-${size}.webp` })
export const imageVariantPaths = identity => SIZES.map(size => buildTenantBlobPath(options(identity, size)))
export function standardImageVariant(width, height, quality) {
  return quality === 80 && SIZES.includes(width) && height === width ? width : null
}

// Only four bounded, content-versioned derivatives per source image. Never public.
export async function getOrCreateImageVariant(identity, size, generate, afterPersist = async () => {}) {
  if (!SIZES.includes(size)) throw new Error('Unsupported thumbnail size')
  const upload = options(identity, size)
  const pathname = buildTenantBlobPath(upload)
  // A cache outage must not prevent serving the original image.
  const cached = await getTenantBlob(pathname, { access: 'private' }).catch(() => null)
  if (cached?.statusCode === 200 && cached.stream) return cached.stream
  const bytes = await generate()
  try {
    await uploadTenantBlob({ ...upload, body: bytes, contentType: 'image/webp', access: 'private' })
  } catch {
    // Concurrent creators can collide, or cache storage can be unavailable.
    // Serve the already generated image; a future request may retry caching.
  }
  await afterPersist()
  return new Blob([bytes]).stream()
}
