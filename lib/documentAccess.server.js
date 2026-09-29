import mongoose from 'mongoose'

/** Access to private employee uploads, including files not yet submitted to HR. */
export async function canReadDocumentUpload(auth, { fileId, ownerId }) {
  if (!auth?.success) return false
  const actorId = String(auth.user._id || auth.user.userId || '')
  if (ownerId && actorId === String(ownerId)) return true
  const { User, Document } = auth.models
  const owner = mongoose.Types.ObjectId.isValid(ownerId) ? await User.findById(ownerId).select('_id role').lean() : null
  if (!owner) return false
  if (['admin', 'hr', 'super_admin', 'superadmin'].includes(auth.user.role)) {
    // GridFS is shared storage: privileged access still needs tenant evidence.
    return true
  }
  const actor = await User.findById(actorId).select('employeeId').lean()
  if (!actor?.employeeId) return false
  const approved = [{ status: { $in: ['approved', 'issued'] } }]
  // Preserve old HR-issued records that predate the review-status field.
  if (['admin', 'hr', 'super_admin', 'superadmin'].includes(owner.role)) approved.push({ status: { $exists: false } })
  return Boolean(await Document.exists({ fileId, isActive: { $ne: false }, $and: [{ $or: approved }, { $or: [{ employee: actor.employeeId }, { isCompanyDocument: true }] }] }))
}
