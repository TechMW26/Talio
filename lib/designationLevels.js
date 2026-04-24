/**
 * Designation level convention (higher = more senior).
 *
 *   L9  Director              (top of org tree, reports to nobody)
 *   L8  Assistant Director
 *   L7  C-Suite               (CEO, CTO, CMO, COO, CFO, CHRO, CIO, CISO, Chief X)
 *   L6  Manager / Senior Manager / Head
 *   L5  Assistant Manager
 *   L4  Team Lead / Tech Lead / Supervisor
 *   L3  Senior IC
 *   L2  Mid IC                (default IC)
 *   L1  Junior / Entry / Intern / Trainee
 *
 * Legacy 1-7 numbering (Manager=5, C-Suite=6, Director=7) is upgraded by
 * scripts/migrate-designation-levels.js. Lookups here also tolerate the
 * legacy mapping where possible so reads from un-migrated docs do not crash.
 */

const LEVELS = [
  { level: 1, levelName: 'Entry Level' },
  { level: 2, levelName: 'Mid Level' },
  { level: 3, levelName: 'Senior' },
  { level: 4, levelName: 'Team Lead' },
  { level: 5, levelName: 'Assistant Manager' },
  { level: 6, levelName: 'Manager' },
  { level: 7, levelName: 'C-Suite' },
  { level: 8, levelName: 'Assistant Director' },
  { level: 9, levelName: 'Director' },
]

const LEVEL_NAMES = LEVELS.reduce((acc, l) => {
  acc[l.level] = l.levelName
  return acc
}, {})

// Top of the hierarchy
const DIRECTOR_LEVEL = 9

// Levels eligible to be picked as a "Reports To" target
const REPORTS_TO_CANDIDATE_LEVELS = new Set([7, 8, 9])

// Returns the set of levels a given employee level is allowed to report to.
// Hierarchy: Director (9) reports to nobody; Assistant Director (8) reports only to
// Director; C-Suite (7) reports to Assistant Director or Director; everyone else
// (1-6) reports to C-Suite, Assistant Director, or Director.
function allowedReportsToLevels(level) {
  const n = Number(level) || 0
  if (n >= DIRECTOR_LEVEL) return new Set()
  if (n === 8) return new Set([9])
  if (n === 7) return new Set([8, 9])
  if (n > 0) return new Set([7, 8, 9])
  return new Set()
}

// Levels that can have an "assignedManager" set (Director cannot)
function canHaveAssignedManager(level) {
  const n = Number(level) || 0
  return n > 0 && n < DIRECTOR_LEVEL
}

// Levels that can have an "assignedTeamLead" set: only ICs (below Team Lead)
function canHaveAssignedTeamLead(level) {
  const n = Number(level) || 0
  return n > 0 && n <= 3
}

// Levels that must have a "reportsTo" set (everyone except Director)
function requiresReportsTo(level) {
  const n = Number(level) || 0
  return n > 0 && n < DIRECTOR_LEVEL
}

function levelNameFromNumber(level) {
  return LEVEL_NAMES[Number(level)] || 'Mid Level'
}

function inferLevelFromTitle(title) {
  const t = (title || '').toLowerCase().trim()
  if (!t) return 2
  if (/(intern|trainee|apprentice)/.test(t)) return 1
  if (/\b(jr|junior)\b/.test(t)) return 1
  if (/(asst\.?|assistant)\s*director/.test(t)) return 8
  if (/\bdirector\b/.test(t)) return 9
  if (/(c[etoamfhi]o|chief|president|founder|ceo|cto|cfo|cmo|coo|chro|ciso|cio|cpo)/.test(t)) return 7
  if (/(senior\s*manager|sr\.?\s*manager|principal|head\s*of|head[- ]?manager|\bhead\b)/.test(t)) return 6
  if (/(asst\.?|assistant)\s*manager/.test(t)) return 5
  if (/(manager|architect)/.test(t)) return 6
  if (/(team\s*lead|tech\s*lead|\blead\b|supervisor)/.test(t)) return 4
  if (/(senior|sr\.?)/.test(t)) return 3
  return 2
}

module.exports = {
  LEVELS,
  LEVEL_NAMES,
  DIRECTOR_LEVEL,
  REPORTS_TO_CANDIDATE_LEVELS,
  allowedReportsToLevels,
  canHaveAssignedManager,
  canHaveAssignedTeamLead,
  requiresReportsTo,
  levelNameFromNumber,
  inferLevelFromTitle,
}
