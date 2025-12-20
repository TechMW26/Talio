import mongoose from 'mongoose';

const CourseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  code: {
    type: String,
    required: true,
    unique: true,
  },
  description: {
    type: String,
  },
  category: {
    type: String,
    enum: ['technical', 'soft-skills', 'compliance', 'leadership', 'other'],
    required: true,
  },
  duration: {
    type: Number,
    required: true,
  },
  durationUnit: {
    type: String,
    enum: ['hours', 'days', 'weeks'],
    default: 'hours',
  },
  level: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced'],
    default: 'beginner',
  },
  instructor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
  },
  externalInstructor: {
    name: String,
    email: String,
    organization: String,
  },
  content: [{
    title: String,
    type: { type: String, enum: ['video', 'document', 'quiz', 'assignment'] },
    url: String,
    duration: Number,
    order: Number,
  }],
  prerequisites: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
  }],
  isMandatory: {
    type: Boolean,
    default: false,
  },
  certificateTemplate: {
    type: String,
  },
  passingScore: {
    type: Number,
    default: 70,
  },
  maxAttempts: {
    type: Number,
    default: 3,
  },
  validityPeriod: {
    type: Number,
  },
  thumbnail: {
    type: String,
  },
  thumbnailFileId: {
    type: String, // ImageKit file ID for deletion
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'draft',
  },
  enrollmentCount: {
    type: Number,
    default: 0,
  },
  completionCount: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

export default mongoose.models.Course || mongoose.model('Course', CourseSchema);

