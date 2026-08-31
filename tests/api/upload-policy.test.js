import {
  MAX_UPLOAD_SIZE_BYTES,
  normalizeUploadCategory,
  validateUploadMetadata,
} from '@/lib/platform/uploadPolicy'

describe('managed upload policy', () => {
  test('normalizes known categories and rejects arbitrary paths', () => {
    expect(normalizeUploadCategory(' Documents ')).toBe('documents')
    expect(normalizeUploadCategory('../../public')).toBeNull()
  })

  test('accepts common HR document metadata', () => {
    expect(validateUploadMetadata({
      filename: 'offer-letter.pdf',
      contentType: 'application/pdf',
      size: 1024,
    })).toMatchObject({ valid: true, contentType: 'application/pdf' })
  })

  test('rejects empty, oversized, and executable web content', () => {
    expect(validateUploadMetadata({ filename: 'empty.pdf', contentType: 'application/pdf', size: 0 }).code)
      .toBe('EMPTY_FILE')
    expect(validateUploadMetadata({
      filename: 'huge.pdf',
      contentType: 'application/pdf',
      size: MAX_UPLOAD_SIZE_BYTES + 1,
    }).code).toBe('FILE_TOO_LARGE')
    expect(validateUploadMetadata({ filename: 'payload.svg', contentType: 'image/svg+xml', size: 100 }).code)
      .toBe('UNSAFE_FILE_TYPE')
  })
})
