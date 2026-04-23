// Gemini provider via the public REST API (no SDK dependency). Multi-key
// rotation with health tracking matches the OpenAI provider semantics so the
// router can treat all fallbacks uniformly.

import { KeyRotationManager } from '../keyRotationManager.js';
import { aiLogger, maskKey } from '../logger.js';

const DEFAULT_TEXT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const DEFAULT_VISION_MODEL = process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const DEFAULT_BASE_URL = (process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 60_000);
const GEMINI_TEXT_MODEL_FALLBACKS = [
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-2.0-flash-lite',
];
const GEMINI_VISION_MODEL_FALLBACKS = [
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-2.0-flash-lite',
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

function collectGeminiKeys() {
    const keys = new Set();
    const add = (v) => { if (v && typeof v === 'string') keys.add(v.trim()); };

    add(process.env.GEMINI_API_KEY);
    add(process.env.GEMINI_KEY);

    Object.keys(process.env)
        .filter((k) => /^GEMINI_(API_)?KEY_\d+$/i.test(k))
        .sort()
        .forEach((k) => add(process.env[k]));

    return Array.from(keys).filter(Boolean);
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
        const err = new Error(`Gemini API error ${response.status}: ${text.slice(0, 300)}`);
        err.status = response.status;
        err.model = normalizedModel;
        err.errorClass = errorClass;
        err.isRetryable = errorClass === 'rate_limit' || errorClass === 'server';
        err.isAuthError = errorClass === 'auth';
        err.isModelNotFound = isGeminiModelNotFoundError(err);
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
        const err = new Error('Gemini is not configured');
        err.errorClass = 'unconfigured';
        throw err;
    }

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

                manager.markFailure(index, error.errorClass || 'unknown');
                aiLogger.warn('gemini.failure', {
                    op: opLabel,
                    model: normalizeModelName(model),
                    keyIndex: index,
                    keyMask: maskKey(key),
                    errorClass: error.errorClass || 'unknown',
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

export function _resetGeminiCache() {
    cachedKeyManager = null;
    cachedKeySignature = '';
}
