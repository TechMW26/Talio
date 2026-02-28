/**
 * @deprecated — Use getAuthAndModels(request, ['JobPosting']) from lib/auth.js
 * This standalone model exists only for backward compatibility and seed scripts.
 * The canonical schema lives in lib/tenantModels.js as JobPostingSchema.
 */
import mongoose from 'mongoose';

const JobPostingSchema = new mongoose.Schema({
  jobTitle: { type: String, required: true, trim: true },
  jobCode: { type: String, required: true, trim: true },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  designation: { type: mongoose.Schema.Types.ObjectId, ref: 'Designation' },
  numberOfPositions: { type: Number, required: true, default: 1, min: 1 },
  jobDescription: { type: String, required: true },
  requirements: [{ type: String, trim: true }],
  responsibilities: [{ type: String, trim: true }],
  benefits: [{ type: String, trim: true }],
  skills: [{ type: String, trim: true }],
  educationLevel: { type: String, enum: ['any', 'high-school', 'associate', 'bachelor', 'master', 'doctorate'], default: 'any' },
  experience: { min: { type: Number, default: 0 }, max: { type: Number, default: 0 } },
  salaryRange: {
    min: { type: Number },
    max: { type: Number },
    currency: { type: String, default: 'INR', trim: true },
    isConfidential: { type: Boolean, default: false },
  },
  location: { type: String, trim: true },
  workMode: { type: String, enum: ['on-site', 'remote', 'hybrid'], default: 'on-site' },
  employmentType: { type: String, enum: ['full-time', 'part-time', 'contract', 'internship', 'freelance'], default: 'full-time' },
  status: { type: String, enum: ['draft', 'open', 'on-hold', 'closed', 'cancelled'], default: 'draft' },
  publishedAt: { type: Date },
  applicationDeadline: { type: Date },
  hiringManager: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  recruiters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  hiringPipeline: [{
    stageName: { type: String, required: true },
    stageOrder: { type: Number, required: true },
    isAutoReject: { type: Boolean, default: false },
  }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  closedAt: { type: Date },
  closedReason: { type: String },
}, { timestamps: true, strict: false });

export default mongoose.models.JobPosting || mongoose.model('JobPosting', JobPostingSchema);

