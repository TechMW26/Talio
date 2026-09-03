import mongoose from 'mongoose'

const ProbationApprovalSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  requestType: { type: String, enum: ['confirmation', 'extension'], required: true },
  extensionMonths: { type: Number, min: 1, max: 24, default: null },
  requestRemarks: { type: String, trim: true, maxlength: 2000, default: '' },
  requestedByUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requestedByEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  approverUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  approverEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  approverSource: {
    type: String,
    enum: ['reportingManager', 'assignedTeamLead', 'assignedManager', 'reportsTo'],
    required: true,
  },
  status: { type: String, enum: ['pending', 'processing', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
  decisionRemarks: { type: String, trim: true, maxlength: 2000, default: '' },
  decidedAt: { type: Date, default: null },
  lifecycleSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, strict: true })

ProbationApprovalSchema.index(
  { employee: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['pending', 'processing'] } } },
)
ProbationApprovalSchema.index({ approverUser: 1, status: 1, createdAt: -1 })

export default mongoose.models.ProbationApproval || mongoose.model('ProbationApproval', ProbationApprovalSchema)
