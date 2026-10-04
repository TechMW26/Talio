import { profileDocumentUrl } from '@/lib/client/profileDocumentUrl'
const origin = 'https://app.talio.in'
test('keeps authenticated API URLs without a duplicate prefix', () => {
  expect(profileDocumentUrl({ url: '/api/images/abc' }, origin)).toBe('/api/images/abc')
  expect(profileDocumentUrl({ url: '/uploads/aadhaar/front.png' }, origin)).toBe('/api/uploads/aadhaar/front.png')
  expect(profileDocumentUrl({ url: `${origin}/api/images/abc?w=500` }, origin)).toBe('/api/images/abc?w=500')
})
test('uses native media IDs before stale historical URLs', () => {
  const fileId = 'a'.repeat(24)
  expect(profileDocumentUrl({ fileId, url: 'https://old.invalid/image' }, origin)).toBe(`/api/images/${fileId}`)
})
test('retains external providers without forwarding authorization, rejects status flags and unsafe URLs', () => {
  expect(profileDocumentUrl({ url: 'https://ik.imagekit.io/image.png' }, origin)).toBe('https://ik.imagekit.io/image.png')
  expect(profileDocumentUrl({ url: true }, origin)).toBeNull()
  expect(profileDocumentUrl({ url: 'javascript:alert(1)' }, origin)).toBeNull()
})
