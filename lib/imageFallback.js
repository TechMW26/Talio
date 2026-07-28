export const DEFAULT_AVATAR_SRC = '/default-avatar.png'
export const DEFAULT_IMAGE_SRC = '/image-placeholder.svg'

const AVATAR_HINTS = [
  'avatar',
  'employee',
  'member',
  'participant',
  'person',
  'profile',
  'user',
]

function unwrapNextImageSource(source) {
  if (!source || typeof source !== 'string') return ''

  try {
    const parsed = new URL(source, 'http://localhost')
    if (parsed.pathname !== '/_next/image') return source
    return parsed.searchParams.get('url') || source
  } catch {
    return source
  }
}

export function getFallbackImageSrc({ src = '', alt = '', className = '' } = {}) {
  const originalSource = unwrapNextImageSource(src)
  const context = `${originalSource} ${alt} ${className}`.toLowerCase()

  return AVATAR_HINTS.some((hint) => context.includes(hint))
    ? DEFAULT_AVATAR_SRC
    : DEFAULT_IMAGE_SRC
}

export function applyImageFallback(image, failedSource) {
  if (!image) return false

  const currentSource = image.currentSrc || image.src || ''
  if (currentSource && failedSource && currentSource !== failedSource) {
    return false
  }

  const fallbackSource = getFallbackImageSrc({
    src: failedSource || currentSource,
    alt: image.alt,
    className: image.className,
  })

  if (
    currentSource.endsWith(fallbackSource) ||
    image.dataset.imageFallbackSource === fallbackSource
  ) {
    return false
  }

  image.dataset.imageFallbackSource = fallbackSource
  image.removeAttribute('srcset')
  image.removeAttribute('sizes')
  image.src = fallbackSource
  return true
}
