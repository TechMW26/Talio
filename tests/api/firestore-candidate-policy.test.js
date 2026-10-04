const { datasetPolicy, assertIsolated, invalidateAcceptance } = require('../../scripts/firestore-migration/dataset-policy.cjs')

describe('migration candidate isolation', () => {
  const candidate = datasetPolicy('live-firestore-20261004-01', true)
  const catalog = { applicationCutover: false, purpose: 'production-candidate', status: 'verified-production-candidate' }

  test('local defaults remain isolated and live requires explicit flag', () => {
    expect(datasetPolicy('local-firestore-20261003-01').purpose).toBe('local-acceptance-only')
    expect(() => datasetPolicy('live-firestore-20261004-01')).toThrow()
    expect(() => datasetPolicy('local-firestore-20261003-01', true)).toThrow()
    expect(() => assertIsolated(catalog, candidate, true)).not.toThrow()
  })

  test.each([
    { ...catalog, applicationCutover: true },
    { ...catalog, purpose: 'production' },
    { ...catalog, purpose: 'local-acceptance-only' },
    { ...catalog, status: 'materializing' },
  ])('refuses active, mismatched, or unverified catalog %#', value => {
    expect(() => assertIsolated(value, candidate, true)).toThrow()
  })

  test('writes invalidate prior acceptance with a fresh revision', async () => {
    const root = {}, tx = { get: jest.fn(async () => ({ data: () => catalog })), update: jest.fn() }
    const firestore = { runTransaction: fn => fn(tx) }
    await invalidateAcceptance(firestore, root, candidate)
    const first = tx.update.mock.calls[0][1]
    await invalidateAcceptance(firestore, root, candidate)
    expect(first.nativeAcceptance).toBeNull()
    expect(first.nativeVerificationRevision).not.toBe(tx.update.mock.calls[1][1].nativeVerificationRevision)
    expect(first.applicationCutover).toBeUndefined()
  })

  test('refuses invalidation after promotion', async () => {
    const tx = { get: jest.fn(async () => ({ data: () => ({ ...catalog, applicationCutover: true }) })), update: jest.fn() }
    await expect(invalidateAcceptance({ runTransaction: fn => fn(tx) }, {}, candidate)).rejects.toThrow()
    expect(tx.update).not.toHaveBeenCalled()
  })
})
