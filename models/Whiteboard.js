import mongoose from 'mongoose';

const WhiteboardObjectSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: {
    type: String,
    enum: ['pencil', 'highlighter', 'line', 'arrow', 'curvedArrow', 'dottedArrow', 'pigtailArrow', 'connector', 'rect', 'ellipse', 'diamond', 'triangle', 'star', 'hexagon', 'pentagon', 'polygon', 'sticky', 'text', 'image'],
    required: true
  },
  // Common properties
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
  rotation: { type: Number, default: 0 },
  strokeColor: { type: String, default: '#000000' },
  fillColor: { type: String, default: 'transparent' },
  strokeWidth: { type: Number, default: 2 },
  opacity: { type: Number, default: 1 },
  cornerRadius: { type: Number, default: 0 },
  borderRadius: { type: Number, default: 0 },

  // Path-based objects (pencil, line, arrows)
  points: [{ x: Number, y: Number }],

  // Arrow-specific properties
  arrowType: { type: String, enum: ['straight', 'curved', 'elbow'], default: 'straight' },
  lineStyle: { type: String, enum: ['solid', 'dashed', 'dotted'], default: 'solid' },
  controlPoint: { type: mongoose.Schema.Types.Mixed }, // {x: Number, y: Number} for curved arrows
  pathPoints: [{ x: Number, y: Number }], // Temporary drawing path (cleared after save)

  // Connector-specific properties (for dynamic element-to-element connections)
  startElementId: { type: String }, // ID of the element where connector starts
  endElementId: { type: String }, // ID of the element where connector ends
  startPoint: { type: mongoose.Schema.Types.Mixed }, // {x, y, edge: 'top'|'bottom'|'left'|'right'|'auto'}
  endPoint: { type: mongoose.Schema.Types.Mixed }, // {x, y, edge: 'top'|'bottom'|'left'|'right'|'auto'}
  curvature: { type: Number, default: 0.5 }, // 0-1, how curved the connector is
  connectorStyle: { type: String, enum: ['bezier', 'straight', 'step'], default: 'bezier' },

  // Grouping
  groupId: { type: String },

  // Text properties
  text: { type: String },
  fontSize: { type: Number, default: 16 },
  fontFamily: { type: String, default: 'Arial' },
  fontWeight: { type: String, default: 'normal' },
  textAlign: { type: String, default: 'left' },
  bold: { type: Boolean, default: false },
  italic: { type: Boolean, default: false },
  underline: { type: Boolean, default: false },

  // Image properties
  imageData: { type: String }, // base64 or URL
  originalWidth: { type: Number },
  originalHeight: { type: Number },

  // Polygon-specific
  sides: { type: Number, default: 6 },

  // Eraser strokes attached to this object
  eraserStrokes: [{
    points: [{ x: Number, y: Number }],
    width: { type: Number, default: 20 }
  }],

  // Locking
  locked: { type: Boolean, default: false },

  // Layer order
  zIndex: { type: Number, default: 0 },

  // Generation tracking (for AI-plotted elements)
  generationId: { type: String } // Links element to a specific AI generation
}, { _id: false });

const WhiteboardPageSchema = new mongoose.Schema({
  id: { type: String, required: true },
  objects: [WhiteboardObjectSchema],
  thumbnail: { type: String }, // base64 thumbnail
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

// AI Analysis Chat Message Schema
const AIMessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

// AI Analysis Schema
// Agent Generation Schema (for sidebar persistence with history support)
const AgentGenerationSchema = new mongoose.Schema({
  id: { type: String, required: true }, // Unique ID for this generation
  templateType: { type: String, enum: ['mindmap', 'flowchart', 'planning', 'ideas'] },
  title: { type: String },
  description: { type: String },
  sections: [{
    title: { type: String },
    summary: { type: String },
    items: [{ type: String }],
    color: { type: mongoose.Schema.Types.Mixed } // {fill, stroke, text, border, bg}
  }],
  conclusion: { type: String },
  userPrompt: { type: String },
  isPlotted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { _id: false });

// Agent Content State Schema (tracks current and history)
const AgentContentStateSchema = new mongoose.Schema({
  currentGenerationId: { type: String }, // ID of the currently active generation
  generations: [AgentGenerationSchema] // All generations (history)
}, { _id: false });

const AIAnalysisSchema = new mongoose.Schema({
  summary: { type: String, default: '' },
  messages: [AIMessageSchema],
  lastAnalyzedAt: { type: Date },
  notes: [{ type: String }],
  keyPoints: [{ type: String }],
  // Agent content state with history support
  agentContent: { type: AgentContentStateSchema, default: null },
  // Legacy field for backward compatibility (will migrate to agentContent)
  agentPreparedContent: { type: mongoose.Schema.Types.Mixed, default: null }
}, { _id: false });

const WhiteboardShareSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  permission: {
    type: String,
    enum: ['view_only', 'editor', 'owner'],
    default: 'view_only'
  },
  sharedAt: { type: Date, default: Date.now },
  sharedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { _id: false });

const WhiteboardSchema = new mongoose.Schema({
  title: { type: String, required: true, default: 'Untitled Board' },
  description: { type: String, default: '' },

  // Owner
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Pages
  pages: { type: [WhiteboardPageSchema], default: () => [{ id: 'page-1', objects: [] }] },
  currentPageIndex: { type: Number, default: 0 },

  // Theme settings
  theme: {
    type: String,
    enum: ['white', 'black', 'chalk'],
    default: 'white'
  },
  chalkTextureUrl: { type: String, default: '' },
  showGrid: { type: Boolean, default: false },

  // View state (saved per user, but we can store default)
  defaultZoom: { type: Number, default: 1 },
  defaultPanX: { type: Number, default: 0 },
  defaultPanY: { type: Number, default: 0 },

  // Sharing
  sharing: [WhiteboardShareSchema],
  isPublic: { type: Boolean, default: false },
  publicLink: { type: String, unique: true, sparse: true },

  // Metadata
  thumbnail: { type: String }, // Main board thumbnail (first page) - URL or base64
  thumbnailFileId: { type: String }, // ImageKit file ID for deletion
  tags: [{ type: String }],

  // Folder/Organization
  folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'WhiteboardFolder' },

  // AI Analysis
  aiAnalysis: { type: AIAnalysisSchema, default: () => ({ summary: '', messages: [], notes: [], keyPoints: [] }) },

  // Timestamps
  lastModified: { type: Date, default: Date.now },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
});

// Indexes
WhiteboardSchema.index({ owner: 1, createdAt: -1 });
WhiteboardSchema.index({ 'sharing.userId': 1 });
WhiteboardSchema.index({ title: 'text', description: 'text', tags: 'text' });

// Update lastModified on save
WhiteboardSchema.pre('save', function (next) {
  this.lastModified = new Date();
  next();
});

// Virtual for full board data export
WhiteboardSchema.virtual('exportData').get(function () {
  return {
    version: '1.0',
    title: this.title,
    pages: this.pages,
    theme: this.theme,
    showGrid: this.showGrid,
    exportedAt: new Date().toISOString()
  };
});

// Static method to generate unique public link
WhiteboardSchema.statics.generatePublicLink = function () {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Check if user has permission
WhiteboardSchema.methods.hasPermission = function (userId, requiredPermission = 'view_only') {
  const userIdStr = userId.toString();

  // Owner has all permissions
  if (this.owner.toString() === userIdStr) {
    return true;
  }

  // Check sharing
  const share = this.sharing.find(s => s.userId.toString() === userIdStr);
  if (!share) {
    return this.isPublic && requiredPermission === 'view_only';
  }

  const permissionLevels = { 'view_only': 1, 'editor': 2, 'owner': 3 };
  return permissionLevels[share.permission] >= permissionLevels[requiredPermission];
};

// Get user's permission level
WhiteboardSchema.methods.getUserPermission = function (userId) {
  const userIdStr = userId.toString();

  if (this.owner.toString() === userIdStr) {
    return 'owner';
  }

  const share = this.sharing.find(s => s.userId.toString() === userIdStr);
  if (share) {
    return share.permission;
  }

  if (this.isPublic) {
    return 'view_only';
  }

  return null;
};

// Folder schema for organizing whiteboards
const WhiteboardFolderSchema = new mongoose.Schema({
  name: { type: String, required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  parentFolder: { type: mongoose.Schema.Types.ObjectId, ref: 'WhiteboardFolder' },
  color: { type: String, default: '#6366f1' }
}, {
  timestamps: true
});

WhiteboardFolderSchema.index({ owner: 1, name: 1 });

export const WhiteboardFolder = mongoose.models.WhiteboardFolder || mongoose.model('WhiteboardFolder', WhiteboardFolderSchema);
export default mongoose.models.Whiteboard || mongoose.model('Whiteboard', WhiteboardSchema);
