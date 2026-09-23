// Centralised AI model configuration.
// All consumers should import from here rather than hardcoding model strings.
// Text stays on DeepSeek; vision stays on Pollinations.

export const AI_MODELS = {
  // Default text model — DeepSeek Flash
  PRIMARY: 'deepseek-flash',
  PRO: 'deepseek-v4-pro',

  // Default vision model — Gemini 3.7 Flash (fast multimodal, OCR-friendly)
  VISION_PRIMARY: 'gemini',

  // Fallback — tried after PRIMARY on 404 (model unavailable)
  FALLBACK: 'deepseek-flash',

  // Secondary fallbacks tried in order after PRIMARY and FALLBACK
  SECONDARY_FALLBACKS: [],

  // Legacy reference (kept for env overrides / documentation)
  LEGACY_LITE: 'deepseek-flash',
};

/**
 * Dynamic use-case → model routing table.
 * Routine text uses Flash; complex tasks use Pro with Flash fallback on 404.
 * Vision is isolated on Pollinations.
 */
export const AI_USE_CASES = {
  default:    { model: AI_MODELS.PRIMARY },
  chat:       { model: AI_MODELS.PRIMARY },
  mira:       { model: AI_MODELS.PRIMARY },
  'mira-actions': { model: AI_MODELS.PRO, thinking: true },
  assistant:  { model: AI_MODELS.PRIMARY },
  creative:   { model: AI_MODELS.PRIMARY },
  json:       { model: AI_MODELS.PRIMARY },
  spellcheck: { model: AI_MODELS.PRIMARY },
  analysis:   { model: AI_MODELS.PRO, thinking: true },
  reasoning:  { model: AI_MODELS.PRO, thinking: true },
  vision:     { model: 'gemini', fallbacks: ['openai'] },
};

/**
 * Resolve a use-case name to a model config. Unknown names fall back to the
 * `default` entry so the system never throws on a missing key.
 * @param {string} useCase
 */
export function resolveUseCase(useCase) {
  return AI_USE_CASES[useCase] || AI_USE_CASES.default;
}
