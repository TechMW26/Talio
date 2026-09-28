import mongoose from 'mongoose'

const PerformanceAppraisalSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  reviewPeriod: { type: String, required: true, trim: true, maxlength: 80 },
  proposedIncreasePercent: { type: Number, required: true, min: 0, max: 100 },
  reason: { type: String, required: true, trim: true, maxlength: 4000 },
  pointers: [{ type: String, trim: true, maxlength: 500 }],
  requestedByUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requestedByEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  status: {
    type: String,
    enum: ['pending_approval', 'hr_discussion', 'approved', 'rejected'],
    default: 'pending_approval',
    index: true,
  },
  approvalSteps: [{
    role: { type: String, enum: ['team_leader', 'manager', 'department_head', 'hr'], required: true },
    coveredRoles: [{ type: String, enum: ['team_leader', 'manager', 'department_head'] }],
    approverUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approverUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    approverEmployee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    comment: { type: String, trim: true, maxlength: 2000, default: '' },
    actedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actedAt: { type: Date, default: null },
  }],
  currentStepIndex: { type: Number, default: 0, min: 0 },
  workflowVersion: { type: Number, default: 1 },
  hrDiscussion: {
    notes: { type: String, trim: true, maxlength: 4000, default: '' },
    outcome: { type: String, enum: ['approved', 'rejected', null], default: null },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    completedAt: { type: Date, default: null },
  },
  timeline: [{
    type: { type: String, enum: ['submitted', 'approved', 'rejected', 'hr_discussion_completed'], required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, required: true },
    message: { type: String, trim: true, maxlength: 2000, default: '' },
    at: { type: Date, default: Date.now },
  }],
}, { timestamps: true, strict: true })

PerformanceAppraisalSchema.index({ employee: 1, createdAt: -1 })
PerformanceAppraisalSchema.index(
  { employee: 1, reviewPeriod: 1 },
  { unique: true, partialFilterExpression: { $or: [{ status: 'pending_approval' }, { status: 'hr_discussion' }] } },
)
PerformanceAppraisalSchema.index({ status: 1, currentStepIndex: 1, updatedAt: -1 })
PerformanceAppraisalSchema.index({ requestedByUser: 1, createdAt: -1 })
PerformanceAppraisalSchema.index({ 'approvalSteps.approverUser': 1, status: 1 })
PerformanceAppraisalSchema.index({ 'approvalSteps.approverUsers': 1, status: 1 })

export default mongoose.models.PerformanceAppraisal || mongoose.model('PerformanceAppraisal', PerformanceAppraisalSchema)
