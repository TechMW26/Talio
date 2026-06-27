// Gemini provider via the public REST API. Features:
//   - Gemini 3.5 Flash as primary (multimodal, text + vision)
//   - Key validation at load time (AIza / AQ prefixes)
//   - Serialized global request queue (one call at a time, 500ms min gap)
//   - Retry-After header + retryDelay body parsing on 429
//   - Graceful fallback to gemini-2.0-flash on 404/403

import { KeyRotationManager } from '../keyRotationManager.js';
import { aiLogger, maskKey } from '../logger.js';
import { AI_MODELS } from '../models.js';

const DEFAULT_TEXT_MODEL = process.env.GEMINI_MODEL || AI_MODELS.PRIMARY;
const DEFAULT_VISION_MODEL = process.env.GEMINI_VISION_MODEL || AI_MODELS.PRIMARY;
const DEFAULT_BASE_URL = (process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 60_000);

// ── Global serialised request queue ───────────────────────────────────
// All Gemini calls funnel through this queue so at most ONE request is
// in-flight at any time. Uses a promise-chain mutex pattern.
const MIN_REQUEST_INTERVAL_MS = Number(process.env.GEMINI_MIN_REQUEST_INTERVAL_MS || 500);
let _queueTail = Promise.resolve();
let _lastRequestTime = 0;
let _requestCounter = 0;

/**
 * Enqueue an async operation so it runs exclusively with a minimum gap
 * between calls. Returns the result of `fn()`.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function enqueueRequest(fn) {
    const reqId = ++_requestCounter;
    // Chain onto the tail so requests execute strictly one-after-another.
    const task = _queueTail.then(async () => {
        // Enforce minimum gap from the previous request
        const now = Date.now();
        const gap = Math.max(0, _lastRequestTime + MIN_REQUEST_INTERVAL_MS - now);
        if (gap > 0) {
            await new Promise((r) => setTimeout(r, gap));
        }
        _lastRequestTime = Date.now();
        return fn();
    });
    // Don't let a rejection break the chain — catch and rethrow after
    // advancing the tail so subsequent requests still run.
    _queueTail = task.catch(() => { });
    return task;
}

// ── Model fallback chains ────────────────────────────────────────────
// 3.5 Flash is primary. If it returns 404 (model not available) or 403
// (access denied), fall back through 2.5-flash → flash-latest → 2.0-flash.
const GEMINI_TEXT_MODEL_FALLBACKS = [
    AI_MODELS.PRIMARY,
    ...AI_MODELS.SECONDARY_FALLBACKS,
];
const GEMINI_VISION_MODEL_FALLBACKS = [
    AI_MODELS.PRIMARY,
    ...AI_MODELS.SECONDARY_FALLBACKS,
];

function normalizeModelName(model = '') {
    return `${model || ''}`.trim().replace(/^models\//, '');
}

function buildModelCandidates(primaryModel, fallbackModels = []) {
    return Array.from(new Set([
        normalizeModelName(primaryModel),
        ...fallbackModels.map(normalizeModelName),
    ].filter(Boolean)));
}

// ── Key collection with AIza validation ───────────────────────────────

let _keyValidationLogged = false;

function collectGeminiKeys() {
    const validKeys = [];
    const rejectedKeys = [];

    // Collect numbered keys GEMINI_API_KEY_1 .. GEMINI_API_KEY_N in numeric order
    const numberedSlots = Object.keys(process.env)
        .filter((k) => /^GEMINI_API_KEY_\d+$/i.test(k))
        .sort((a, b) => {
            const na = parseInt(a.match(/\d+$/)?.[0] || '0', 10);
            const nb = parseInt(b.match(/\d+$/)?.[0] || '0', 10);
            return na - nb;
        });

    for (const k of numberedSlots) {
        const v = (process.env[k] || '').trim();
        if (!v) continue; // skip empty slots silently
        if (v.length >= 10) {
            validKeys.push(v);
        } else {
            rejectedKeys.push({ slot: k, prefix: v.slice(0, 6), reason: 'too short' });
        }
    }

    // Legacy key names
    const legacy = (process.env.GEMINI_API_KEY || '').trim();
    if (legacy) {
        if (legacy.length >= 10) validKeys.push(legacy);
        else rejectedKeys.push({ slot: 'GEMINI_API_KEY (legacy)', prefix: legacy.slice(0, 6), reason: 'too short' });
    }
    const gemKey = (process.env.GEMINI_KEY || '').trim();
    if (gemKey) {
        if (gemKey.length >= 10) validKeys.push(gemKey);
        else rejectedKeys.push({ slot: 'GEMINI_KEY', prefix: gemKey.slice(0, 6), reason: 'too short' });
    }

    // Log validation once per process lifetime
    if (!_keyValidationLogged) {
        _keyValidationLogged = true;
        console.log(`[Gemini] Key validation: ${validKeys.length} valid, ${rejectedKeys.length} rejected`);
        for (const r of rejectedKeys) {
            console.warn(`[Gemini] ⚠️  Rejected ${r.slot} — ${r.reason || 'invalid format'}.`);
        }
        if (validKeys.length === 0) {
            console.error('[Gemini] ❌ ZERO valid Gemini API keys found. All AI features will fail. Get keys from https://aistudio.google.com/apikey');
        }
        for (let i = 0; i < validKeys.length; i++) {
            const k = validKeys[i];
            const masked = k.length > 10 ? `${k.slice(0, 6)}…${k.slice(-2)}` : '***';
            console.log(`[Gemini]   Key #${i + 1}: ${masked}`);
        }
    }

    // Deduplicate
    return [...new Set(validKeys)];
}

let cachedKeyManager = null;
let cachedKeySignature = '';

function getKeyManager() {
    const keys = collectGeminiKeys();
    const signature = keys.join('|');
    if (!cachedKeyManager || cachedKeySignature !== signature) {
        cachedKeyManager = new KeyRotationManager('gemini', keys);
        cachedKeySignature = signature;
    }
    return cachedKeyManager;
}

export function isGeminiConfigured() {
    return getKeyManager().size > 0;
}

export function getGeminiAvailability() {
    const manager = getKeyManager();
    return { configured: manager.size > 0, keys: manager.size, status: manager.getStatus() };
}

function classifyGeminiError(status, body) {
    if (status === 401 || status === 403) return 'auth';
    if (status === 429) return 'rate_limit';
    if (status >= 500) return 'server';
    if (typeof body === 'string' && /quota|exceeded|RESOURCE_EXHAUSTED/i.test(body)) return 'rate_limit';
    return 'client';
}

/**
 * Parse retry delay from a 429 error body. Google returns retryDelay in
 * the error details array:
 *   {"error":{"details":[{"@type":"...google.rpc.RetryInfo","retryDelay":"18s"}]}}
 * Also checks the Retry-After HTTP header as fallback.
 * Returns milliseconds to wait. Default: 60s.
 */
function parseRetryDelayFromError(responseBody, responseHeaders) {
    // 1. Try Retry-After HTTP header first
    const headerVal = responseHeaders?.get?.('retry-after') || responseHeaders?.get?.('Retry-After');
    if (headerVal) {
        const seconds = parseInt(headerVal, 10);
        if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
        const date = Date.parse(headerVal);
        if (Number.isFinite(date)) return Math.max(1000, date - Date.now());
    }

    // 2. Try parsing retryDelay from the JSON error body
    try {
        const parsed = typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody;
        const details = parsed?.error?.details;
        if (Array.isArray(details)) {
            for (const detail of details) {
                if (detail?.retryDelay) {
                    // retryDelay is a Duration string like "18s" or "2.5s"
                    const match = String(detail.retryDelay).match(/^(\d+(?:\.\d+)?)s$/);
                    if (match) return Math.ceil(parseFloat(match[1]) * 1000);
                }
            }
        }
    } catch {
        // Body isn't valid JSON — ignore
    }

    return 60_000; // Default: 60 seconds
}

function isGeminiModelNotFoundError(error) {
    if (!error || error.status !== 404) {
        return false;
    }

    return /not found|listmodels|supported for generatecontent/i.test(`${error.message || ''}`);
}

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function callGemini(model, apiKey, body) {
    const normalizedModel = normalizeModelName(model);
    const url = `${DEFAULT_BASE_URL}/models/${encodeURIComponent(normalizedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    let response;
    try {
        response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }, DEFAULT_TIMEOUT_MS);
    } catch (error) {
        const causeCode = error?.cause?.code || error?.code || (error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
        const wrapped = new Error(`Gemini request failed (${causeCode}): ${error.message}`);
        wrapped.code = causeCode;
        wrapped.errorClass = 'network';
        wrapped.isRetryable = true;
        throw wrapped;
    }

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        const errorClass = classifyGeminiError(response.status, text);
        const retryDelayMs = errorClass === 'rate_limit'
            ? parseRetryDelayFromError(text, response.headers)
            : null;

        const err = new Error(`Gemini API error ${response.status}: ${text.slice(0, 300)}`);
        err.status = response.status;
        err.model = normalizedModel;
        err.errorClass = errorClass;
        err.isRetryable = errorClass === 'rate_limit' || errorClass === 'server';
        err.isAuthError = errorClass === 'auth';
        err.isModelNotFound = isGeminiModelNotFoundError(err);
        if (retryDelayMs) err.retryAfterMs = retryDelayMs;
        throw err;
    }

    const json = await response.json();
    const parts = json?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p?.text || '').join('').trim();
    if (!text) {
        const err = new Error('Gemini returned an empty response');
        err.errorClass = 'empty';
        err.isRetryable = true;
        throw err;
    }
    return text;
}

function buildTextBody(prompt, systemInstruction) {
    const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
    };
    if (systemInstruction) {
        body.systemInstruction = { role: 'system', parts: [{ text: systemInstruction }] };
    }
    return body;
}

function buildVisionBody(prompt, images) {
    const parts = [{ text: prompt || 'Describe the provided image(s).' }];
    for (const image of images) {
        parts.push({
            inlineData: {
                mimeType: image.mimeType || 'image/png',
                data: image.data,
            },
        });
    }
    return { contents: [{ role: 'user', parts }] };
}

async function runWithRotation(models, body, opLabel) {
    const manager = getKeyManager();
    if (manager.size === 0) {
        const err = new Error('Gemini is not configured — no valid AIza-prefixed keys found');
        err.errorClass = 'unconfigured';
        throw err;
    }

    // Serialise ALL Gemini calls through the global queue so only one
    // request is in-flight at any time, with a minimum gap between calls.
    return enqueueRequest(async () => {
        const modelCandidates = Array.isArray(models) ? models : [models];
        let lastError = null;

        for (const model of modelCandidates) {
            let advancedToNextModel = false;

            for (const { index, key } of manager.iterateHealthy()) {
                const startedAt = Date.now();
                try {
                    const result = await callGemini(model, key, body);
                    manager.markSuccess(index);
                    aiLogger.info('gemini.success', {
                        op: opLabel,
                        model: normalizeModelName(model),
                        keyIndex: index,
                        keyMask: maskKey(key),
                        latencyMs: Date.now() - startedAt,
                    });
                    return result;
                } catch (error) {
                    lastError = error;

                    if (isGeminiModelNotFoundError(error)) {
                        aiLogger.warn('gemini.model_unavailable', {
                            op: opLabel,
                            model: normalizeModelName(model),
                            latencyMs: Date.now() - startedAt,
                            message: error.message,
                        });
                        advancedToNextModel = true;
                        break;
                    }

                    // Honour retry delay from 429 (Retry-After header + retryDelay body)
                    const cooldownMs = error.retryAfterMs || undefined;
                    manager.markFailure(index, error.errorClass || 'unknown', cooldownMs);
                    aiLogger.warn('gemini.failure', {
                        op: opLabel,
                        model: normalizeModelName(model),
                        keyIndex: index,
                        keyMask: maskKey(key),
                        errorClass: error.errorClass || 'unknown',
                        retryAfterMs: cooldownMs || 'default',
                        latencyMs: Date.now() - startedAt,
                        message: error.message,
                    });
                    if (!error.isRetryable && !error.isAuthError) {
                        throw error;
                    }
                }
            }

            if (!advancedToNextModel && lastError) {
                throw lastError;
            }
        }

        throw lastError || new Error('All Gemini keys exhausted');
    });
}

export async function generateGeminiContent(prompt, systemInstruction = '') {
    return runWithRotation(
        buildModelCandidates(DEFAULT_TEXT_MODEL, GEMINI_TEXT_MODEL_FALLBACKS),
        buildTextBody(prompt, systemInstruction),
        'text'
    );
}

export async function generateGeminiVisionContent(prompt, images = []) {
    if (!images.length) {
        throw new Error('No images provided for Gemini vision analysis');
    }
    return runWithRotation(
        buildModelCandidates(DEFAULT_VISION_MODEL, GEMINI_VISION_MODEL_FALLBACKS),
        buildVisionBody(prompt, images),
        'vision'
    );
}

/**
 * Vision call accepting a pre-built image buffer (e.g. our stitched
 * productivity composite). Gemini does not need the contact-sheet shrinking
 * the Custom AI / Inference services apply, so we just transcode to base64
 * and reuse the standard vision pipeline.
 */
export async function generateGeminiRawVisionContent(prompt, { buffer, mimeType = 'image/webp' } = {}) {
    if (!buffer || !buffer.length) {
        throw new Error('No buffer provided for Gemini raw vision analysis');
    }
    const data = Buffer.isBuffer(buffer) ? buffer.toString('base64') : Buffer.from(buffer).toString('base64');
    return runWithRotation(
        buildModelCandidates(DEFAULT_VISION_MODEL, GEMINI_VISION_MODEL_FALLBACKS),
        buildVisionBody(prompt, [{ data, mimeType }]),
        'vision'
    );
}

export function _resetGeminiCache() {
    cachedKeyManager = null;
    cachedKeySignature = '';
}
