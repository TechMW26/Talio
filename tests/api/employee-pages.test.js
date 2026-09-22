import { collectEmployeePages, isCompleteEmployeeList } from '@/lib/client/employeePages'

describe('complete employee lists', () => {
  test('loads employees beyond both the first 100 and 1000 records', async () => {
    const fetchPage = jest.fn(async url => {
      const page = Number(new URL(url, 'http://test').searchParams.get('page'))
      const start = (page - 1) * 100
      return { success: true, data: Array.from({ length: Math.min(100, 1170 - start) }, (_, i) => ({ _id: String(start + i) })), pagination: { pages: 12 } }
    })
    const result = await collectEmployeePages('/api/employees?all=true&status=active&limit=100', fetchPage)
    expect(result.data).toHaveLength(1170)
    expect(result.data[1169]._id).toBe('1169')
    expect(fetchPage).toHaveBeenCalledTimes(12)
    expect(fetchPage.mock.calls.every(([url]) => url.includes('status=active') && !url.includes('all='))).toBe(true)
  })
  test('preserves the server search on every directory page and deduplicates', async () => {
    const fetchPage = jest.fn().mockResolvedValueOnce({ data: [{ _id: '1' }, { _id: '2' }], meta: { hasMore: true } })
      .mockResolvedValueOnce({ data: [{ _id: '2' }, { _id: '3' }], meta: { hasMore: false } })
    const result = await collectEmployeePages('/api/directory?all=true&q=Tech+Team', fetchPage)
    expect(result.data.map(e => e._id)).toEqual(['1', '2', '3'])
    expect(fetchPage.mock.calls[1][0]).toContain('q=Tech+Team')
  })
  test('surfaces later-page failures rather than presenting incomplete success', async () => {
    const fetchPage = jest.fn().mockResolvedValueOnce({ data: [{ _id: '1' }], meta: { hasMore: true } }).mockRejectedValueOnce(new Error('Network failed'))
    await expect(collectEmployeePages('/api/directory?all=true', fetchPage)).rejects.toThrow('Network failed')
  })
  test('stops broken pagination instead of looping forever', async () => {
    await expect(collectEmployeePages('/api/directory', async () => ({ data: [{ _id: '1' }], meta: { hasMore: true } }))).rejects.toThrow('did not advance')
  })
  test('does not affect deliberate table pagination or other resources', () => {
    expect(isCompleteEmployeeList('/api/employees?page=2')).toBe(false)
    expect(isCompleteEmployeeList('/api/employees/123?all=true')).toBe(false)
    expect(isCompleteEmployeeList('/api/directory?all=true')).toBe(true)
  })
})
