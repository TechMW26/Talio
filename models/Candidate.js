/**
 * @deprecated - Use getAuthAndModels(request, ['Candidate']) from lib/auth.js
 * The canonical schema lives in lib/tenantModels.js as CandidateSchema.
 */
import mongoose from 'mongoose';

const CandidateSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, trim: true },
  jobPosting: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPosting', required: true },
  resume: { name: { type: String }, url: { type: String }, uploadedAt: { type: Date, default: Date.now } },
  coverLetter: { type: String },
  currentCompany: { type: String, trim: true },
  currentDesignation: { type: String, trim: true },
  totalExperience: { type: Number },
  currentSalary: { type: Number },
  expectedSalary: { type: Number },
  noticePeriod: { type: Number },
  skills: [{ type: String, trim: true }],
  education: [{ degree: String, institution: String, year: Number, grade: String }],
  source: { type: String, enum: ['website', 'referral', 'linkedin', 'naukri', 'indeed', 'glassdoor', 'career-page', 'agency', 'other'], default: 'website' },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  stage: { type: String, enum: ['applied', 'screening', 'shortlisted', 'interview', 'assessment', 'offer', 'hired', 'rejected', 'withdrawn'], default: 'applied' },
  stageHistory: [{
    stage: { type: String, required: true },
    movedAt: { type: Date, default: Date.now },
    movedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    notes: { type: String },
  }],
  rating: { type: Number, min: 0, max: 5 },
  overallScore: { type: Number, min: 0, max: 100 },
  offer: {
    offeredDate: { type: Date },
    joiningDate: { type: Date },
    salary: { type: Number },
    designation: { type: String },
    status: { type: String, enum: ['pending', 'accepted', 'rejected', 'withdrawn', 'negotiating'] },
    offerLetterUrl: { type: String },
    notes: { type: String },
  },
  rejectionReason: { type: String },
  notes: [{
    note: { type: String, required: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    addedAt: { type: Date, default: Date.now },
  }],
  tags: [{ type: String, trim: true }],
  convertedEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
}, { timestamps: true, strict: false });

export default mongoose.models.Candidate || mongoose.model('Candidate', CandidateSchema);

