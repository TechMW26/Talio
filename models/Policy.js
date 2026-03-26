import mongoose from 'mongoose';

const PolicySchema = new mongoose.Schema({
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
  content: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    enum: ['hr', 'it', 'security', 'compliance', 'code-of-conduct', 'finance', 'other'],
    required: true,
  },
  version: {
    type: Number,
    default: 1,
  },
  effectiveDate: {
    type: Date,
    required: true,
  },
  expiryDate: {
    type: Date,
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
  },
  companies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
  }],
  departments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
  }],
  applicableTo: {
    type: String,
    enum: ['all', 'department', 'company', 'specific'],
    default: 'all',
  },
  specificEmployees: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
  }],
  requiresAcknowledgment: {
    type: Boolean,
    default: true,
  },
  acknowledgments: [{
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    acknowledgedDate: Date,
    ipAddress: String,
  }],
  attachments: [{
    name: String,
    url: String,
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
  },
  approvedDate: {
    type: Date,
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'archived', 'expired'],
    default: 'draft',
  },
  previousVersions: [{
    version: Number,
    content: String,
    effectiveDate: Date,
    archivedDate: Date,
  }],
  // Enhanced fields
  type: {
    type: String,
    enum: ['policy', 'procedure', 'guideline', 'manual', 'handbook', 'code', 'standard'],
    default: 'policy'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  summary: {
    type: String,
    maxlength: 500
  },
  // Enhanced applicability
  applicability: {
    departments: [String],
    designations: [String],
    locations: [String],
    employeeTypes: [String],
    excludedEmployees: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    }]
  },
  // Document management
  documents: [{
    name: String,
    originalName: String,
    filePath: String,
    fileSize: Number,
    mimeType: String,
    version: String,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    category: {
      type: String,
      enum: ['main_document', 'appendix', 'form', 'template', 'reference']
    }
  }],
  // Training and compliance
  training: {
    trainingRequired: { type: Boolean, default: false },
    trainingDeadline: Date,
    completedTraining: [{
      employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
      },
      completedAt: Date,
      score: Number,
      certificateIssued: Boolean
    }]
  },
  // Analytics
  analytics: {
    totalViews: { type: Number, default: 0 },
    downloadCount: { type: Number, default: 0 },
    acknowledgmentRate: { type: Number, default: 0 }
  },
  views: [{
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    viewedAt: {
      type: Date,
      default: Date.now
    },
    duration: Number
  }],
  // Tags and search
  tags: [String],
  keywords: [String],
  // Feedback
  feedback: [{
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    feedback: String,
    type: {
      type: String,
      enum: ['suggestion', 'clarification', 'concern', 'appreciation']
    },
    isAnonymous: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['open', 'acknowledged', 'resolved'],
      default: 'open'
    },
    response: String,
    respondedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee'
    },
    respondedAt: Date,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  // Review dates
  reviewDate: Date,
  nextReviewDate: Date,
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  }
}, {
  timestamps: true,
});

// Methods
PolicySchema.methods.isApplicableTo = function (employee) {
  if (this.applicableTo === 'all') return true
  if (this.applicableTo === 'specific') {
    return this.specificEmployees.some(id => id.toString() === employee._id.toString())
  }
  if (this.applicableTo === 'company') {
    const companyIds = (this.companies || []).map(id => id.toString())
    const deptIds = (this.departments || []).map(id => id.toString())
    const empCompany = employee.company?.toString()
    const empDepts = [employee.department, ...(employee.departments || [])].filter(Boolean).map(d => d.toString())
    const matchesCompany = companyIds.length === 0 || (empCompany && companyIds.includes(empCompany))
    const matchesDept = deptIds.length === 0 || empDepts.some(d => deptIds.includes(d))
    return matchesCompany && matchesDept
  }
  if (this.applicableTo === 'department') {
    const deptIds = (this.departments || []).map(id => id.toString())
    if (deptIds.length > 0) {
      const empDepts = [employee.department, ...(employee.departments || [])].filter(Boolean).map(d => d.toString())
      return empDepts.some(d => deptIds.includes(d))
    }
    return this.department && this.department.toString() === employee.department?.toString()
  }
  return false
}

PolicySchema.methods.addView = function (employeeId, duration = 0) {
  this.views.push({
    employee: employeeId,
    viewedAt: new Date(),
    duration
  })
  this.analytics.totalViews += 1
}

PolicySchema.methods.addAcknowledgment = function (employeeId, ipAddress = '') {
  const existingAck = this.acknowledgments.find(ack =>
    ack.employee.toString() === employeeId.toString()
  )

  if (!existingAck) {
    this.acknowledgments.push({
      employee: employeeId,
      acknowledgedDate: new Date(),
      ipAddress
    })
  }
}

// Indexes
// code already indexed via unique: true
PolicySchema.index({ category: 1, status: 1 })
PolicySchema.index({ effectiveDate: 1, expiryDate: 1 })
PolicySchema.index({ tags: 1 })

export default mongoose.models.Policy || mongoose.model('Policy', PolicySchema);

