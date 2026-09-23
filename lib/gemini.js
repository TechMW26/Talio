// Backwards-compatible shim. All AI calls in the application import
// `generateContent`, `generateVisionContent`, and `getAIAvailability` from
// this module. DeepSeek text / Pollinations vision routing lives in
// lib/ai/aiProviderManager.js.

export {
    generateContent,
    streamContent,
    generateVisionContent,
    generateStitchedVisionContent,
    getAIAvailability,
} from './ai/aiProviderManager.js';
