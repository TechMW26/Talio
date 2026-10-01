/** Resolve only this employee's existing KYC files in the authenticated tenant. */
export async function getOnboardingKycEvidence(models, employeeId) {
  const user = await models.User.findOne({ employeeId })
    .select('profileCompletion.aadhaarFront profileCompletion.aadhaarBack').lean()
  const files = ['Front', 'Back'].flatMap(side => {
    const file = user?.profileCompletion?.[`aadhaar${side}`]
    return file?.url ? [{ fileName: `Aadhaar Card (${side})`, fileUrl: file.url }] : []
  })
  return files.length ? { aadhaar: files } : {}
}
