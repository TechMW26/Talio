/**
 * Plan Features Configuration
 * 
 * Features are organized into BUNDLES (feature sets). Each bundle groups
 * related capabilities that are toggled together as a single unit.
 * The underlying boolean flags are preserved for sidebar gating.
 */

// ──────────────────────────────────────────────
// Feature bundles – each bundle is a toggleable set
// ──────────────────────────────────────────────
export const FEATURE_BUNDLES = {
  attendanceLeaves: {
    label: 'Attendance & Leaves',
    description: 'GPS attendance, geofencing, and leave management',
    icon: '📍',
    features: ['gpsAttendance', 'geofencing', 'leaveManagement'],
  },
  projectsTasks: {
    label: 'Projects & Task Management',
    description: 'Project coordination, task tracking, and team collaboration',
    icon: '📋',
    features: ['projects'],
  },
  productivity: {
    label: 'Productivity Tracking',
    description: 'Employee productivity monitoring and live user tracking',
    icon: '📊',
    features: ['productivity', 'liveUsers'],
  },
  talioBoard: {
    label: 'TalioBoard',
    description: 'Interactive whiteboard for brainstorming and planning',
    icon: '🎨',
    features: ['talioBoard'],
  },
  meetings: {
    label: 'Meetings',
    description: 'Video conferencing and meeting management',
    icon: '📹',
    features: ['meetings'],
  },
  chat: {
    label: 'Chat',
    description: 'Team messaging, channels, and direct messages',
    icon: '💬',
    features: ['teamChat'],
  },
  payroll: {
    label: 'Payroll & Expenses',
    description: 'Automated payroll processing and expense management',
    icon: '💰',
    features: ['payroll', 'expenses'],
  },
  miraAI: {
    label: 'MIRA AI',
    description: 'AI-powered workflows and strategic intelligence',
    icon: '✦',
    features: ['miraAI', 'strategicAI'],
  },
  hrPeople: {
    label: 'HR & People',
    description: 'Employee management, performance, and recruitment',
    icon: '👥',
    features: ['employees', 'performance', 'recruitment'],
  },
  communication: {
    label: 'Mail & Announcements',
    description: 'Internal mail system and company announcements',
    icon: '📢',
    features: ['mail', 'announcements'],
  },
  resources: {
    label: 'Resources & Knowledge',
    description: 'Documents, assets, helpdesk, policies, learning, and ideas',
    icon: '📚',
    features: ['documents', 'assets', 'helpdesk', 'policies', 'learning', 'ideas'],
  },
  calendarHolidays: {
    label: 'Calendar & Holidays',
    description: 'Company calendar and holiday management',
    icon: '📅',
    features: ['holidays', 'calendar'],
  },
  reports: {
    label: 'Reports',
    description: 'Basic and advanced operational reports',
    icon: '📈',
    features: ['basicReports', 'advancedReports'],
  },
  mobileAccess: {
    label: 'Mobile App Access',
    description: 'Allow employees to use the mobile app',
    icon: '📱',
    features: ['mobileApp'],
  },
  enterprise: {
    label: 'Enterprise Controls',
    description: 'Custom integrations, API access, custom domain, and priority support',
    icon: '🏢',
    features: ['customIntegrations', 'apiAccess', 'customDomain', 'advancedControls', 'prioritySupport'],
  },
};

// All bundle keys
export const ALL_BUNDLE_KEYS = Object.keys(FEATURE_BUNDLES);

// ──────────────────────────────────────────────
// Individual feature catalogue (kept for sidebar mapping & schema)
// ──────────────────────────────────────────────
export const FEATURE_DEFINITIONS = {
  gpsAttendance:      { label: 'GPS Attendance Tracking',   bundle: 'attendanceLeaves' },
  geofencing:         { label: 'Geofencing',                bundle: 'attendanceLeaves' },
  leaveManagement:    { label: 'Leave Management',          bundle: 'attendanceLeaves' },
  teamChat:           { label: 'Team Chat',                 bundle: 'chat' },
  mail:               { label: 'Mail',                      bundle: 'communication' },
  meetings:           { label: 'Meetings',                  bundle: 'meetings' },
  announcements:      { label: 'Announcements',             bundle: 'communication' },
  projects:           { label: 'Projects & Task Coordination', bundle: 'projectsTasks' },
  productivity:       { label: 'Productivity Tracking',     bundle: 'productivity' },
  talioBoard:         { label: 'TalioBoard (Whiteboard)',   bundle: 'talioBoard' },
  employees:          { label: 'Employee Management',       bundle: 'hrPeople' },
  liveUsers:          { label: 'Live Users',                bundle: 'productivity' },
  performance:        { label: 'Goals & OKRs / Performance', bundle: 'hrPeople' },
  recruitment:        { label: 'Recruitment',               bundle: 'hrPeople' },
  payroll:            { label: 'Auto Payroll',              bundle: 'payroll' },
  expenses:           { label: 'Expense Management',        bundle: 'payroll' },
  documents:          { label: 'Documents',                 bundle: 'resources' },
  assets:             { label: 'Asset Management',          bundle: 'resources' },
  helpdesk:           { label: 'Helpdesk',                  bundle: 'resources' },
  policies:           { label: 'Policies',                  bundle: 'resources' },
  learning:           { label: 'Learning (LMS)',            bundle: 'resources' },
  ideas:              { label: 'Ideas / Innovation Hub',    bundle: 'resources' },
  holidays:           { label: 'Holidays',                  bundle: 'calendarHolidays' },
  calendar:           { label: 'General Calendar',          bundle: 'calendarHolidays' },
  mobileApp:          { label: 'Mobile App Access',         bundle: 'mobileAccess' },
  basicReports:       { label: 'Basic Operational Reports', bundle: 'reports' },
  advancedReports:    { label: 'Full Operational Reports',  bundle: 'reports' },
  miraAI:             { label: 'MIRA AI Workflow',          bundle: 'miraAI' },
  strategicAI:        { label: 'Strategic AI Enablement',   bundle: 'miraAI' },
  customIntegrations: { label: 'Custom Integrations',       bundle: 'enterprise' },
  apiAccess:          { label: 'API Access',                bundle: 'enterprise' },
  customDomain:       { label: 'Custom Domain',             bundle: 'enterprise' },
  advancedControls:   { label: 'Advanced Control Options',  bundle: 'enterprise' },
  prioritySupport:    { label: 'Priority Support',          bundle: 'enterprise' },
};

// Helper: all feature keys
export const ALL_FEATURE_KEYS = Object.keys(FEATURE_DEFINITIONS);

/**
 * Check if a bundle is ON (all its features are true).
 */
export function isBundleEnabled(features, bundleKey) {
  const bundle = FEATURE_BUNDLES[bundleKey];
  if (!bundle || !features) return false;
  return bundle.features.every((fk) => features[fk] === true);
}

/**
 * Toggle an entire bundle on or off.
 * Returns a new features object with the bundle's features set.
 */
export function toggleBundle(features, bundleKey, enabled) {
  const bundle = FEATURE_BUNDLES[bundleKey];
  if (!bundle) return features;
  const updated = { ...features };
  bundle.features.forEach((fk) => { updated[fk] = enabled; });
  return updated;
}

// ──────────────────────────────────────────────
// Plan templates
// ──────────────────────────────────────────────

const BUDGET_FEATURES = {
  gpsAttendance: true,
  geofencing: false,
  leaveManagement: true,
  teamChat: false,
  mail: false,
  meetings: false,
  announcements: true,
  projects: false,
  productivity: false,
  talioBoard: false,
  employees: true,
  liveUsers: false,
  performance: false,
  recruitment: false,
  payroll: false,
  expenses: false,
  documents: true,
  assets: false,
  helpdesk: false,
  policies: true,
  learning: false,
  ideas: false,
  holidays: true,
  calendar: true,
  mobileApp: true,
  basicReports: true,
  advancedReports: false,
  miraAI: false,
  strategicAI: false,
  customIntegrations: false,
  apiAccess: false,
  customDomain: false,
  advancedControls: false,
  prioritySupport: false,
};

const STARTER_FEATURES = {
  ...BUDGET_FEATURES,
  teamChat: true,
  mail: true,
  meetings: true,
  talioBoard: true,
  expenses: true,
  assets: true,
  ideas: true,
  advancedReports: true,
};

const PROFESSIONAL_FEATURES = {
  ...STARTER_FEATURES,
  geofencing: true,
  projects: true,
  productivity: true,
  liveUsers: true,
  performance: true,
  recruitment: true,
  payroll: true,
  helpdesk: true,
  learning: true,
  miraAI: true,
  prioritySupport: true,
};

const ENTERPRISE_FEATURES = {
  ...PROFESSIONAL_FEATURES,
  strategicAI: true,
  customIntegrations: true,
  apiAccess: true,
  customDomain: true,
  advancedControls: true,
};

// All features ON for custom / trial defaults
const ALL_ON = Object.fromEntries(ALL_FEATURE_KEYS.map((k) => [k, true]));

export const PLAN_TEMPLATES = {
  budget: {
    label: 'Budget',
    price: 99,
    priceLabel: '₹99/user/month',
    tagline: 'Entry-level productivity control for small teams',
    maxUsers: 50,
    maxStorageGB: 5,
    features: BUDGET_FEATURES,
    miraTokensPerUser: 0,
  },
  starter: {
    label: 'Starter',
    price: 280,
    priceLabel: '₹280/user/month',
    tagline: 'Operational discipline plus essential HRMS add-ons',
    maxUsers: 100,
    maxStorageGB: 10,
    features: STARTER_FEATURES,
    miraTokensPerUser: 100, // 100 tokens per user for first month
  },
  professional: {
    label: 'Professional',
    price: 380,
    priceLabel: '₹380/user/month',
    tagline: 'Full productivity utility with MIRA and deeper visibility',
    maxUsers: 200,
    maxStorageGB: 50,
    features: PROFESSIONAL_FEATURES,
    miraTokensPerUser: 0, // included with miraAI feature
  },
  enterprise: {
    label: 'Enterprise',
    price: 0,
    priceLabel: 'Custom',
    tagline: 'Deployment flexibility, integrations, and strategic control',
    maxUsers: 500,
    maxStorageGB: 100,
    features: ENTERPRISE_FEATURES,
    miraTokensPerUser: 0,
  },
  trial: {
    label: 'Trial',
    price: 0,
    priceLabel: 'Free',
    tagline: '14-day full-access trial',
    maxUsers: 25,
    maxStorageGB: 1,
    features: ALL_ON,
    miraTokensPerUser: 50,
  },
  custom: {
    label: 'Custom',
    price: 0,
    priceLabel: 'Custom',
    tagline: 'Manually configure features for this company',
    maxUsers: 10,
    maxStorageGB: 1,
    features: ALL_ON,
    miraTokensPerUser: 0,
  },
};

/**
 * Get the default features for a given plan.
 * Returns a plain object { featureKey: boolean }.
 */
export function getFeaturesForPlan(plan) {
  return { ...(PLAN_TEMPLATES[plan]?.features || ALL_ON) };
}

/**
 * Get the default limits for a given plan.
 */
export function getLimitsForPlan(plan) {
  const tpl = PLAN_TEMPLATES[plan];
  if (!tpl) return { maxUsers: 10, maxStorageGB: 1 };
  return { maxUsers: tpl.maxUsers, maxStorageGB: tpl.maxStorageGB };
}

// ──────────────────────────────────────────────
// Feature → Sidebar mapping
// Maps feature keys to sidebar menu item names so
// the Sidebar component can hide gated items.
// ──────────────────────────────────────────────
export const FEATURE_TO_SIDEBAR_MAP = {
  teamChat:       ['Chat'],
  mail:           ['Mail'],
  meetings:       ['Meetings'],
  projects:       ['Projects'],
  productivity:   ['Productivity'],
  talioBoard:     ['TalioBoard'],
  employees:      ['Employees'],
  liveUsers:      ['Live Users'],
  performance:    ['Performance'],
  recruitment:    ['Recruitment'],
  payroll:        ['Payroll'],
  expenses:       ['Expenses'],
  documents:      ['Documents'],
  assets:         ['Assets'],
  helpdesk:       ['Helpdesk'],
  policies:       ['Policies'],
  learning:       ['Learning (LMS)'],
  ideas:          ['Ideas'],
  announcements:  ['Announcements'],
  holidays:       ['Holidays'],
  calendar:       ['General Calendar'],
};

/**
 * Given a features object { key: bool }, returns a Set of sidebar
 * menu item names that should be HIDDEN.
 */
export function getHiddenSidebarItems(features) {
  const hidden = new Set();
  if (!features) return hidden;
  for (const [featureKey, menuNames] of Object.entries(FEATURE_TO_SIDEBAR_MAP)) {
    if (features[featureKey] === false) {
      menuNames.forEach((n) => hidden.add(n));
    }
  }
  return hidden;
}
