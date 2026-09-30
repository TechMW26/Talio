import { fetchDocumentFile, preloadDocumentFiles, clearDocumentFileCache } from '@/lib/client/documentFile'

describe('authenticated document loading', () => {
  beforeEach(() => {
    clearDocumentFileCache()
    localStorage.setItem('token', 'private-token')
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['file'], { type: 'application/pdf' }) })
  })
  test('hover preload is reused by opening and repeated hovering', async () => {
    await preloadDocumentFiles([{ fileUrl: '/api/files/preload' }])
    await fetchDocumentFile('/api/files/preload')
    await preloadDocumentFiles([{ fileUrl: '/api/files/preload' }])
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  test('deduplicates in-flight loads without one consumer aborting another', async () => {
    let finish
    fetch.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const controller = new AbortController()
    const first = fetchDocumentFile('/api/files/shared', { signal: controller.signal })
    const second = fetchDocumentFile('/api/files/shared')
    controller.abort()
    await expect(first).rejects.toHaveProperty('name', 'AbortError')
    finish({ ok: true, blob: async () => new Blob(['file']) })
    await expect(second).resolves.toBeInstanceOf(Blob)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  test('does not reuse files across authentication changes', async () => {
    await fetchDocumentFile('/api/files/private')
    localStorage.setItem('token', 'different-session')
    await fetchDocumentFile('/api/files/private')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  test('failed preloads are retried when opened', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 503 })
    await preloadDocumentFiles([{ fileUrl: '/api/files/retry' }])
    await expect(fetchDocumentFile('/api/files/retry')).resolves.toBeInstanceOf(Blob)
    expect(fetch).toHaveBeenCalledTimes(2)
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
