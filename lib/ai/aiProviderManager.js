// Gemini-only AI provider. All text/vision requests route through Gemini with
// multi-key rotation (pool of keys from GEMINI_API_KEY_1 … GEMINI_API_KEY_N).
// Public surface is identical to the original lib/gemini.js exports so existing
// call sites (whiteboard, productivity, MIRA, ideas, holidays, employee bulk
// import, AI assistant, news article, dashboard insights, etc.) work unchanged.

import {
    generateGeminiContent,
    generateGeminiVisionContent,
    generateGeminiRawVisionContent,
    getGeminiAvailability,
    isGeminiConfigured,
} from './providers/geminiProvider.js';
import { aiLogger } from './logger.js';

const MAX_RETRIES = 3;

/**
 * Wrap a Gemini call with retry logic. On rate-limit (429) the
 * KeyRotationManager inside geminiProvider already rotates to the next key.
 * We retry up to MAX_RETRIES times with a short delay between attempts
 * to give cooldowns time to expire.
 */
async function withRetry(fn, opLabel) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        try {
            const startedAt = Date.now();
            const result = await fn();
            aiLogger.info('gemini.success', {
                op: opLabel,
                attempt,
                latencyMs: Date.now() - startedAt,
            });
            return result;
        } catch (error) {
            lastError = error;
            const isRetryable =
                error?.errorClass === 'rate_limit' ||
                error?.errorClass === 'server' ||
                error?.errorClass === 'network' ||
                error?.isRetryable;

            aiLogger.warn('gemini.attempt_failed', {
                op: opLabel,
                attempt,
                errorClass: error?.errorClass || 'unknown',
                message: error?.message?.slice(0, 200),
                retryable: !!isRetryable,
            });

            if (!isRetryable || attempt >= MAX_RETRIES) {
                break;
            }

            // Exponential backoff with jitter before retry
            // (Key-level cooldowns from Retry-After are already applied
            // inside geminiProvider, so we keep this short.)
            const baseDelay = Math.min(1000 * (2 ** (attempt - 1)), 8000);
            const jitter = Math.random() * 200; // ±0-200ms jitter
            await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
        }
    }

    // All retries exhausted
    const err = new Error(
        `Gemini AI call failed after ${MAX_RETRIES} attempts: ${lastError?.message || 'unknown error'}`
    );
    err.errorClass = lastError?.errorClass || 'exhausted';
    err.cause = lastError;
    throw err;
}

export async function generateContent(prompt, systemInstruction = '') {
    return withRetry(
        () => generateGeminiContent(prompt, systemInstruction),
        'text'
    );
}

export async function generateVisionContent(prompt, images = []) {
    return withRetry(
        () => generateGeminiVisionContent(prompt, images),
        'vision'
    );
}

/**
 * Vision call accepting a pre-built image buffer (already optimized for size
 * and legibility). The productivity composite analyzer uses this so the
 * stitched mosaic reaches the model without further client-side shrinking.
 */
export async function generateStitchedVisionContent(prompt, payload) {
    return withRetry(
        () => generateGeminiRawVisionContent(prompt, payload),
        'rawVision'
    );
}

export function getAIAvailability() {
    const gemini = getGeminiAvailability();

    return {
        // Backward-compatible fields.
        anyAvailable: gemini.configured,
        geminiConfigured: gemini.configured,
        geminiKeys: gemini.keys,
        // Extended diagnostics.
        providers: { gemini },
        provider: 'gemini',
    };
}

export function _resetRouterHealth() {
    // No-op in Gemini-only mode — key rotation manager handles its own health.
}

