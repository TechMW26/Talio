import {
  DEFAULT_AVATAR_SRC,
  DEFAULT_IMAGE_SRC,
  applyImageFallback,
  getFallbackImageSrc,
} from '@/lib/imageFallback'

describe('image recovery', () => {
  it('uses an avatar fallback for profile media behind Next image optimization', () => {
    const source = `/_next/image?url=${encodeURIComponent(
      'https://ik.imagekit.io/talio/profiles/person.webp'
    )}&w=96&q=75`

    expect(getFallbackImageSrc({ src: source, alt: 'Employee photo' })).toBe(
      DEFAULT_AVATAR_SRC
    )
  })

  it('uses a neutral fallback for non-profile images', () => {
    expect(
      getFallbackImageSrc({
        src: 'https://example.com/announcement.png',
        alt: 'Announcement',
      })
    ).toBe(DEFAULT_IMAGE_SRC)
  })

  it('removes responsive sources before applying the fallback', () => {
    const image = document.createElement('img')
    image.alt = 'User avatar'
    image.src = 'https://example.com/missing.jpg'
    image.srcset = 'https://example.com/missing-2x.jpg 2x'
    image.sizes = '48px'

    expect(applyImageFallback(image, image.src)).toBe(true)
    expect(image.getAttribute('src')).toBe(DEFAULT_AVATAR_SRC)
    expect(image.hasAttribute('srcset')).toBe(false)
    expect(image.hasAttribute('sizes')).toBe(false)
  })

  it('does not overwrite a component fallback that already changed the source', () => {
    const image = document.createElement('img')
    image.src = 'https://example.com/component-fallback.png'

    expect(
      applyImageFallback(image, 'https://example.com/original.png')
    ).toBe(false)
    expect(image.src).toContain('component-fallback.png')
  })
})
