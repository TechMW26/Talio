// Centralised AI model configuration.
// All consumers should import from here rather than hardcoding model strings.

export const AI_MODELS = {
  // Primary — Gemini 3.5 Flash (multimodal, supports text + vision)
  PRIMARY: 'gemini-3.5-flash',

  // Fallback — if 3.5 returns 404/403, retry with this
  FALLBACK: 'gemini-2.0-flash',

  // Secondary fallbacks tried in order after PRIMARY and FALLBACK
  SECONDARY_FALLBACKS: [
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-2.0-flash',
  ],

  // Legacy reference (keep for documentation / env overrides)
  LEGACY_LITE: 'gemini-2.0-flash-lite',
};
