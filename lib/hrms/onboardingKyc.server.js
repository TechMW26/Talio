/** Resolve only this employee's existing KYC files in the authenticated tenant. */
export async function getNativeOnboardingKycEvidence(database, employeeId) {
  const { records } = await database.list('users', { filters: [{ field: 'employeeId', operator: '==', value: String(employeeId) }], limit: 2 })
  if (records.length > 1) throw new Error('Employee account mapping is ambiguous')
  const files = ['Front', 'Back'].flatMap(side => {
    const file = records[0]?.profileCompletion?.[`aadhaar${side}`]
    return file?.url ? [{ fileName: `Aadhaar Card (${side})`, fileUrl: file.url }] : []
  })
  return files.length ? { aadhaar: files } : {}
}
