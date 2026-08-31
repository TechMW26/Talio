'use client'

import { FEATURE_DEFINITIONS } from '@/lib/planFeatures'
import {
  HRMS_PHASES,
  getHrmsModulesByPhase,
  toggleHrmsModule,
} from '@/lib/hrms/moduleRegistry'

const MODULES_BY_PHASE = getHrmsModulesByPhase()

export default function HrmsModuleControls({ features, onChange }) {
  const toggleModule = (featureKey) => {
    onChange(toggleHrmsModule(features, featureKey, features[featureKey] !== true))
  }

  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">HRMS Workflow Modules</h2>
        <p className="text-sm text-gray-500 mt-1">
          Control every stage independently. Prerequisites are enabled automatically and disabling a prerequisite also disables dependent stages.
        </p>
      </div>

      <div className="space-y-5">
        {Object.entries(HRMS_PHASES).map(([phaseKey, phase]) => (
          <section key={phaseKey} aria-labelledby={`workflow-phase-${phaseKey}`}>
            <div className="flex items-baseline gap-2 mb-2">
              <h3 id={`workflow-phase-${phaseKey}`} className="text-sm font-semibold text-gray-900">{phase.label}</h3>
              <p className="text-xs text-gray-500">{phase.description}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {MODULES_BY_PHASE[phaseKey].map((module) => {
                const enabled = features[module.key] === true
                return (
                  <button
                    key={module.key}
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => toggleModule(module.key)}
                    className={`flex items-start justify-between gap-3 rounded-xl border p-3 text-left transition-colors ${
                      enabled ? 'border-purple-300 bg-purple-50' : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className={`block text-sm font-medium ${enabled ? 'text-purple-900' : 'text-gray-600'}`}>
                        {module.label}
                      </span>
                      <span className="block mt-1 text-xs text-gray-500">
                        {module.dependencies.length
                          ? `Requires ${module.dependencies.map((key) => FEATURE_DEFINITIONS[key]?.label || key).join(', ')}`
                          : 'No prerequisite module'}
                      </span>
                    </span>
                    <span className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors ${enabled ? 'bg-purple-600' : 'bg-gray-300'}`}>
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
