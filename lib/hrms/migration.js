import { HRMS_MODULE_KEYS, normalizeHrmsFeatures } from './moduleRegistry.js'

export const HRMS_WORKFLOW_MIGRATION_VERSION = 1

export function buildHrmsFeatureMigration(existingFeatures = {}) {
  const filled = { ...existingFeatures }
  for (const featureKey of HRMS_MODULE_KEYS) {
    if (typeof filled[featureKey] !== 'boolean') filled[featureKey] = false
  }
  return normalizeHrmsFeatures(filled)
}

export function changedFeatureFlags(before = {}, after = {}) {
  return HRMS_MODULE_KEYS.filter((key) => before[key] !== after[key])
}
