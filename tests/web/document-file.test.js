import { fetchDocumentFile } from '@/lib/client/documentFile'

describe('authenticated document loading', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'private-token')
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['file'], { type: 'application/pdf' }) })
  })
  test('authenticates local file delivery', async () => {
    await fetchDocumentFile('/api/files/doc')
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: 'same-origin', headers: { Authorization: 'Bearer private-token' } }))
  })
  test('never forwards credentials to a third-party file host', async () => {
    await fetchDocumentFile('https://files.example.org/doc.pdf')
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: 'omit', headers: {} }))
  })
  test('blocks executable schemes and reports auth failures', async () => {
    await expect(fetchDocumentFile('javascript:alert(1)')).rejects.toThrow('Unsupported')
    fetch.mockResolvedValue({ ok: false, status: 403 })
    await expect(fetchDocumentFile('/api/files/doc')).rejects.toThrow('access')
  })
  test('does not render an HTML login/error page as a file', async () => {
    fetch.mockResolvedValue({ ok: true, blob: async () => new Blob(['login'], { type: 'text/html' }) })
    await expect(fetchDocumentFile('/api/files/doc')).rejects.toThrow('page instead')
  })
})
