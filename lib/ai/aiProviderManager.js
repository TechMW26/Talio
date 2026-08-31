// Pollinations-only AI provider. All text/vision requests route through
// Pollinations.ai (OpenAI-compatible REST API) using a single secret key
// (POLLINATIONS_API_KEY). Public surface is identical to the original
// lib/gemini.js exports so existing call sites (whiteboard, productivity,
// MIRA, ideas, holidays, employee bulk import, AI assistant, news article,
// dashboard insights, etc.) work unchanged.

import {
    generatePollinationsContent,
    generatePollinationsVisionContent,
    generatePollinationsRawVisionContent,
    getPollinationsAvailability,
} from './providers/pollinationsProvider.js';
import { aiLogger } from './logger.js';

const MAX_RETRIES = 3;

/**
 * Wrap a Pollinations call with retry logic. On rate-limit (429) or server
 * errors we retry up to MAX_RETRIES times with exponential backoff and jitter.
 */
async function withRetry(fn, opLabel) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        try {
            const startedAt = Date.now();
            const result = await fn();
            aiLogger.info('pollinations.success', {
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

            aiLogger.warn('pollinations.attempt_failed', {
                op: opLabel,
                attempt,
                errorClass: error?.errorClass || 'unknown',
                message: error?.message?.slice(0, 200),
                retryable: !!isRetryable,
            });

            if (!isRetryable || attempt >= MAX_RETRIES) {
                break;
            }

            const baseDelay = Math.min(1000 * (2 ** (attempt - 1)), 8000);
            const jitter = Math.random() * 200; // ±0-200ms jitter
            await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
        }
    }

    // All retries exhausted
    const err = new Error(
        `Pollinations AI call failed after ${MAX_RETRIES} attempts: ${lastError?.message || 'unknown error'}`
    );
    err.errorClass = lastError?.errorClass || 'exhausted';
    err.cause = lastError;
    throw err;
}

export async function generateContent(prompt, systemInstruction = '', options = {}) {
    return withRetry(
        () => generatePollinationsContent(prompt, systemInstruction, options),
        'text'
    );
}

export async function generateVisionContent(prompt, images = [], options = {}) {
    return withRetry(
        () => generatePollinationsVisionContent(prompt, images, options),
        'vision'
    );
}

/**
 * Vision call accepting a pre-built image buffer (already optimized for size
 * and legibility). The productivity composite analyzer uses this so the
 * stitched mosaic reaches the model without further client-side shrinking.
 */
export async function generateStitchedVisionContent(prompt, payload, options = {}) {
    return withRetry(
        () => generatePollinationsRawVisionContent(prompt, payload, options),
        'rawVision'
    );
}

export function getAIAvailability() {
    const pollinations = getPollinationsAvailability();

    return {
        // Backward-compatible fields.
        anyAvailable: pollinations.configured,
        pollinationsConfigured: pollinations.configured,
        // Extended diagnostics.
        providers: { pollinations },
        provider: 'pollinations',
    };
}

export function _resetRouterHealth() {
    // No-op in Pollinations-only mode — no key rotation state to reset.
}

