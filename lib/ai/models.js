// Centralised AI model configuration.
// All consumers should import from here rather than hardcoding model strings.
// Pollinations.ai is the exclusive provider; models use Pollinations model IDs.

export const AI_MODELS = {
  // Default text model — Pollinations "openai" (OpenAI-compatible)
  PRIMARY: 'openai',

  // Default vision model — Gemini 3.7 Flash (fast multimodal, OCR-friendly)
  VISION_PRIMARY: 'gemini',

  // Fallback — tried after PRIMARY on 404 (model unavailable)
  FALLBACK: 'openai',

  // Secondary fallbacks tried in order after PRIMARY and FALLBACK
  SECONDARY_FALLBACKS: ['openai'],

  // Legacy reference (kept for env overrides / documentation)
  LEGACY_LITE: 'openai',
};

/**
 * Dynamic use-case → model routing table.
 * Each entry picks the best Pollinations model for the job, plus an ordered
 * fallback chain tried when a model returns 404.
 */
export const AI_USE_CASES = {
  default:    { model: 'openai',        fallbacks: ['openai'] },
  chat:       { model: 'openai',        fallbacks: ['openai'] },
  assistant:  { model: 'openai',        fallbacks: ['openai'] },
  creative:   { model: 'openai',        fallbacks: ['openai'] },
  json:       { model: 'openai',        fallbacks: ['openai'] },
  spellcheck: { model: 'openai',        fallbacks: ['openai'] },
  analysis:   { model: 'gpt-5.4',       fallbacks: ['openai'] },
  reasoning:  { model: 'openai-large',  fallbacks: ['openai'] },
  vision:     { model: 'gemini',        fallbacks: ['openai'] },
};

/**
 * Resolve a use-case name to a model config. Unknown names fall back to the
 * `default` entry so the system never throws on a missing key.
 * @param {string} useCase
 */
export function resolveUseCase(useCase) {
  return AI_USE_CASES[useCase] || AI_USE_CASES.default;
}
