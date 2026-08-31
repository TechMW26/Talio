// Pollinations.ai provider via the OpenAI-compatible REST API.
//   - Single secret key (POLLINATIONS_API_KEY, sk_…)
//   - Text via POST /v1/chat/completions (model: openai)
//   - Vision via OpenAI-style image_url parts (data URLs)
//   - Retry-After honouring on 429, graceful model fallback on 404

import { aiLogger, maskKey } from '../logger.js';
import { AI_MODELS, resolveUseCase } from '../models.js';

const DEFAULT_BASE_URL = (process.env.POLLINATIONS_BASE_URL || 'https://gen.pollinations.ai/v1').replace(/\/$/, '');
const DEFAULT_TEXT_MODEL = process.env.POLLINATIONS_TEXT_MODEL || AI_MODELS.PRIMARY;
const DEFAULT_VISION_MODEL = process.env.POLLINATIONS_VISION_MODEL || AI_MODELS.VISION_PRIMARY || AI_MODELS.PRIMARY;
const DEFAULT_TIMEOUT_MS = Number(process.env.POLLINATIONS_TIMEOUT_MS || 45_000);

let _keyValidationLogged = false;

function collectPollinationsKey() {
    const key = (process.env.POLLINATIONS_API_KEY || '').trim();
    if (!key) return null;

    if (!_keyValidationLogged) {
        _keyValidationLogged = true;
        console.log(`[Pollinations] Key loaded: ${maskKey(key)}`);
    }
    return key;
}

function normalizeModelName(model = '') {
    return `${model || ''}`.trim();
}

function buildModelCandidates(primaryModel, fallbackModels = []) {
    return Array.from(new Set([
        normalizeModelName(primaryModel),
        ...fallbackModels.map(normalizeModelName),
    ].filter(Boolean)));
}

/**
 * Resolve a caller request into an ordered model candidate list.
 * Priority: explicit `model` → use-case registry entry → env override.
 */
function resolveCandidates(options = {}, { defaultUseCase = 'default', envModel } = {}) {
    const { model, useCase } = options;
    if (model) {
        return buildModelCandidates(model, []);
    }
    const entry = resolveUseCase(useCase || defaultUseCase);
    // Env override only applies when the caller did not request a specific use case.
    const primary = useCase ? entry.model : (envModel || entry.model);
    return buildModelCandidates(primary, entry.fallbacks || []);
}

export function isPollinationsConfigured() {
    return !!collectPollinationsKey();
}

export function getPollinationsAvailability() {
    return {
        configured: !!collectPollinationsKey(),
        baseUrl: DEFAULT_BASE_URL,
        textModel: DEFAULT_TEXT_MODEL,
        visionModel: DEFAULT_VISION_MODEL,
    };
}

function classifyPollinationsError(status, body) {
    if (status === 401 || status === 403) return 'auth';
    if (status === 429) return 'rate_limit';
    if (status >= 500) return 'server';
    if (typeof body === 'string' && /rate limit|too many requests|quota/i.test(body)) return 'rate_limit';
    return 'client';
}

function isModelNotFoundError(error) {
    return !!error && error.status === 404;
}

function parseRetryAfter(responseHeaders, responseBody) {
    const headerVal = responseHeaders?.get?.('retry-after');
    if (headerVal) {
        const seconds = parseInt(headerVal, 10);
        if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
        const date = Date.parse(headerVal);
        if (Number.isFinite(date)) return Math.max(1000, date - Date.now());
    }
    try {
        const parsed = typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody;
        const ms = parsed?.error?.retry_after_ms || parsed?.retry_after_ms;
        if (Number.isFinite(ms) && ms > 0) return ms;
    } catch {
        // body not JSON — ignore
    }
    return 60_000;
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

async function callPollinations(model, body) {
    const apiKey = collectPollinationsKey();
    if (!apiKey) {
        const err = new Error('Pollinations is not configured — POLLINATIONS_API_KEY is missing');
        err.errorClass = 'unconfigured';
        throw err;
    }

    const url = `${DEFAULT_BASE_URL}/chat/completions`;
    let response;
    try {
        response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        }, DEFAULT_TIMEOUT_MS);
    } catch (error) {
        const causeCode = error?.cause?.code || error?.code || (error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
        const wrapped = new Error(`Pollinations request failed (${causeCode}): ${error.message}`);
        wrapped.code = causeCode;
        wrapped.errorClass = 'network';
        wrapped.isRetryable = true;
        throw wrapped;
    }

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        const errorClass = classifyPollinationsError(response.status, text);
        const retryAfterMs = errorClass === 'rate_limit'
            ? parseRetryAfter(response.headers, text)
            : null;

        const err = new Error(`Pollinations API error ${response.status}: ${text.slice(0, 300)}`);
        err.status = response.status;
        err.model = normalizeModelName(model);
        err.errorClass = errorClass;
        err.isRetryable = errorClass === 'rate_limit' || errorClass === 'server' || errorClass === 'network';
        err.isAuthError = errorClass === 'auth';
        err.isModelNotFound = isModelNotFoundError(err);
        if (retryAfterMs) err.retryAfterMs = retryAfterMs;
        throw err;
    }

    const json = await response.json();
    const text = `${json?.choices?.[0]?.message?.content || ''}`.trim();
    if (!text) {
        const err = new Error('Pollinations returned an empty response');
        err.errorClass = 'empty';
        err.isRetryable = true;
        throw err;
    }
    return text;
}

function buildTextBody(prompt, systemInstruction) {
    const messages = [];
    if (systemInstruction) {
        messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({ role: 'user', content: prompt });
    return { messages };
}

function buildVisionBody(prompt, images) {
    const content = [{ type: 'text', text: prompt || 'Describe the provided image(s).' }];
    for (const image of images) {
        content.push({
            type: 'image_url',
            image_url: {
                url: `data:${image.mimeType || 'image/png'};base64,${image.data}`,
            },
        });
    }
    return { messages: [{ role: 'user', content }] };
}

async function runWithModelFallback(models, body, opLabel) {
    const modelCandidates = Array.isArray(models) ? models : [models];
    let lastError = null;

    for (const model of modelCandidates) {
        const startedAt = Date.now();
        try {
            const result = await callPollinations(model, { ...body, model });
            aiLogger.info('pollinations.success', {
                op: opLabel,
                model: normalizeModelName(model),
                latencyMs: Date.now() - startedAt,
            });
            return result;
        } catch (error) {
            lastError = error;

            if (isModelNotFoundError(error)) {
                aiLogger.warn('pollinations.model_unavailable', {
                    op: opLabel,
                    model: normalizeModelName(model),
                    message: error.message,
                });
                continue;
            }

            aiLogger.warn('pollinations.failure', {
                op: opLabel,
                model: normalizeModelName(model),
                errorClass: error.errorClass || 'unknown',
                retryAfterMs: error.retryAfterMs || 'default',
                latencyMs: Date.now() - startedAt,
                message: error.message,
            });

            if (!error.isRetryable && !error.isAuthError) {
                throw error;
            }
            throw error;
        }
    }

    throw lastError || new Error('All Pollinations models exhausted');
}

export async function generatePollinationsContent(prompt, systemInstruction = '', options = {}) {
    return runWithModelFallback(
        resolveCandidates(options, { defaultUseCase: 'default', envModel: DEFAULT_TEXT_MODEL }),
        buildTextBody(prompt, systemInstruction),
        'text'
    );
}

export async function generatePollinationsVisionContent(prompt, images = [], options = {}) {
    if (!images.length) {
        throw new Error('No images provided for Pollinations vision analysis');
    }
    return runWithModelFallback(
        resolveCandidates(options, { defaultUseCase: 'vision', envModel: DEFAULT_VISION_MODEL }),
        buildVisionBody(prompt, images),
        'vision'
    );
}

/**
 * Vision call accepting a pre-built image buffer (e.g. the stitched
 * productivity composite). Transcoded to base64 and sent as a data URL.
 */
export async function generatePollinationsRawVisionContent(prompt, { buffer, mimeType = 'image/webp' } = {}, options = {}) {
    if (!buffer || !buffer.length) {
        throw new Error('No buffer provided for Pollinations raw vision analysis');
    }
    const data = Buffer.isBuffer(buffer) ? buffer.toString('base64') : Buffer.from(buffer).toString('base64');
    return runWithModelFallback(
        resolveCandidates(options, { defaultUseCase: 'vision', envModel: DEFAULT_VISION_MODEL }),
        buildVisionBody(prompt, [{ data, mimeType }]),
        'vision'
    );
}
