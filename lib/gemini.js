// Backwards-compatible shim. All AI calls in the application import
// `generateContent`, `generateVisionContent`, and `getAIAvailability` from
// this module. The actual routing (Custom AI primary → Inference AI fallback
// → Gemini fallback, with multi-key rotation, health monitoring, and
// structured logging) lives in lib/ai/aiProviderManager.js.

export {
    generateContent,
    generateVisionContent,
    generateStitchedVisionContent,
    getAIAvailability,
} from './ai/aiProviderManager.js';
