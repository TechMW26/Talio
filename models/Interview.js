/**
 * @deprecated - Use getAuthAndModels(request, ['Interview']) from lib/auth.js
 * The canonical schema lives in lib/tenantModels.js as InterviewSchema.
 */
import mongoose from 'mongoose';

const InterviewSchema = new mongoose.Schema({
  candidate: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true },
  jobPosting: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPosting', required: true },
  round: { type: Number, required: true, min: 1 },
  type: { type: String, enum: ['phone', 'video', 'in-person', 'technical', 'hr', 'panel', 'assignment'], default: 'video' },
  title: { type: String, trim: true },
  scheduledDate: { type: Date, required: true },
  duration: { type: Number, default: 60 },
  location: { type: String, trim: true },
  meetingLink: { type: String, trim: true },
  interviewers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  feedback: [{
    interviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    rating: { type: Number, min: 1, max: 5 },
    strengths: { type: String },
    weaknesses: { type: String },
    comments: { type: String },
    recommendation: { type: String, enum: ['strong-hire', 'hire', 'no-hire', 'strong-no-hire', 'undecided'] },
    submittedAt: { type: Date, default: Date.now },
  }],
  status: { type: String, enum: ['scheduled', 'in-progress', 'completed', 'cancelled', 'no-show', 'rescheduled'], default: 'scheduled' },
  cancelReason: { type: String },
  notes: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
}, { timestamps: true, strict: false });

export default mongoose.models.Interview || mongoose.model('Interview', InterviewSchema);
