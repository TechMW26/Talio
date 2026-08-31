// Backwards-compatible shim. All AI calls in the application import
// `generateContent`, `generateVisionContent`, and `getAIAvailability` from
// this module. The actual routing (Pollinations.ai, OpenAI-compatible REST
// API) lives in lib/ai/aiProviderManager.js.

export {
    generateContent,
    generateVisionContent,
    generateStitchedVisionContent,
    getAIAvailability,
} from './ai/aiProviderManager.js';
