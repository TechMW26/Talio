const {
  buildUnassignedApprovalFilter,
  hasReportingChain,
} = require('@/lib/teamScope')

describe('leave approval routing fallbacks', () => {
  test('detects every supported hierarchy edge', () => {
    for (const field of ['assignedManager', 'assignedTeamLead', 'reportsTo', 'reportingManager']) {
      expect(hasReportingChain({ [field]: 'manager-id' })).toBe(true)
    }
    expect(hasReportingChain({})).toBe(false)
    expect(hasReportingChain(null)).toBe(false)
  })

  test('builds an all-fields-unassigned filter for the HR fallback queue', () => {
    const filter = buildUnassignedApprovalFilter()
    expect(filter.$and).toHaveLength(4)
    expect(filter.$and).toEqual(expect.arrayContaining([
      { $or: [{ assignedManager: { $exists: false } }, { assignedManager: null }] },
      { $or: [{ assignedTeamLead: { $exists: false } }, { assignedTeamLead: null }] },
      { $or: [{ reportsTo: { $exists: false } }, { reportsTo: null }] },
      { $or: [{ reportingManager: { $exists: false } }, { reportingManager: null }] },
    ]))
  })
})
