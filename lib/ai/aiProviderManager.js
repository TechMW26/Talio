// Centralized AI provider router. Routes every text/vision request through an
// ordered chain (Custom AI → OpenAI → Gemini), respecting per-provider health,
// per-key rotation, and structured logging. Public surface is intentionally
// identical to the original lib/gemini.js exports so existing call sites
// (whiteboard, productivity, MIRA, ideas, holidays, employee bulk import, AI
// assistant, news article, dashboard insights, etc.) work unchanged.

import {
    generateCustomAIContent,
    generateCustomAIVisionContent,
    getCustomAIAvailability,
    isCustomAIConfigError,
    CUSTOM_AI_CONFIG_ERROR,
} from './providers/customProvider.js';
import {
    generateGeminiContent,
    generateGeminiVisionContent,
    getGeminiAvailability,
} from './providers/geminiProvider.js';
import { ProviderHealthMonitor } from './providerHealthMonitor.js';
import { aiLogger } from './logger.js';

const healthMonitor = new ProviderHealthMonitor();

// Errors that mean "stop trying any provider" — content was bad input, not a
// provider outage. We keep this list deliberately small.
function isFatalRequestError(error) {
    if (!error) return false;
    if (error.errorClass === 'client') return true;
    return false;
}

function shouldFallOver(error) {
    if (!error) return true;
    // Custom-AI: fall over on any non-config error too (network, 5xx, refusal,
    // GPU engine errors, timeouts). Config errors mean it's just disabled.
    if (isCustomAIConfigError(error)) return true;
    // OpenAI/Gemini: fall over on auth/network/server/empty/rate_limit/refusal.
    if (error.errorClass === 'unconfigured') return true;
    if (error.errorClass === 'auth') return true;
    if (error.errorClass === 'rate_limit') return true;
    if (error.errorClass === 'server') return true;
    if (error.errorClass === 'network') return true;
    if (error.errorClass === 'empty') return true;
    // Custom AI legacy errors don't carry errorClass — treat them as
    // fall-overable so OpenAI/Gemini can rescue.
    if (!error.errorClass) return true;
    return false;
}

function buildProviderChain(kind) {
    return [
        {
            name: 'custom',
            available: () => getCustomAIAvailability().configured,
            invoke: kind === 'vision' ? generateCustomAIVisionContent : generateCustomAIContent,
        },
        {
            name: 'gemini',
            available: () => getGeminiAvailability().configured,
            invoke: kind === 'vision' ? generateGeminiVisionContent : generateGeminiContent,
        },
    ];
}

async function routeRequest(kind, args) {
    const chain = buildProviderChain(kind);
    const errors = [];
    let firstError = null;
    let triedAny = false;

    for (const provider of chain) {
        if (!provider.available()) continue;
        if (!healthMonitor.isAvailable(provider.name)) {
            aiLogger.warn('router.skip', { provider: provider.name, reason: 'circuit_open' });
            continue;
        }

        triedAny = true;
        const startedAt = Date.now();
        try {
            const result = await provider.invoke(...args);
            healthMonitor.markSuccess(provider.name);
            aiLogger.info('router.success', {
                provider: provider.name,
                kind,
                latencyMs: Date.now() - startedAt,
                fallback: errors.length > 0,
            });
            return result;
        } catch (error) {
            if (!firstError) firstError = error;
            errors.push({ provider: provider.name, error });
            healthMonitor.markFailure(provider.name);
            aiLogger.warn('router.failure', {
                provider: provider.name,
                kind,
                latencyMs: Date.now() - startedAt,
                message: error?.message,
                errorClass: error?.errorClass || (error?.isContentPolicyError ? 'refusal' : 'unknown'),
            });

            if (isFatalRequestError(error)) {
                throw error;
            }
            if (!shouldFallOver(error)) {
                throw error;
            }
            // Otherwise continue to the next provider.
        }
    }

    if (!triedAny) {
        // No provider was even configured. Preserve historical Custom-AI error
        // so existing tests / operators see the familiar message.
        const err = new Error(CUSTOM_AI_CONFIG_ERROR);
        err.errors = errors;
        throw err;
    }

    // All providers attempted and failed — surface the original (Custom-AI)
    // error to preserve actionable diagnostics; attach aggregated context.
    const aggregate = firstError || new Error('All AI providers failed');
    aggregate.allProviderErrors = errors.map(({ provider, error }) => ({
        provider,
        message: error?.message,
        errorClass: error?.errorClass,
    }));
    throw aggregate;
}

export async function generateContent(prompt, systemInstruction = '') {
    return routeRequest('text', [prompt, systemInstruction]);
}

export async function generateVisionContent(prompt, images = []) {
    return routeRequest('vision', [prompt, images]);
}

export function getAIAvailability() {
    const custom = getCustomAIAvailability();
    const gemini = getGeminiAvailability();

    return {
        // Backward-compatible fields.
        customAI: custom.configured,
        customAIMode: custom.mode,
        anyAvailable: custom.configured || gemini.configured,
        // Extended diagnostics.
        providers: {
            custom,
            gemini,
        },
        health: healthMonitor.snapshot(),
    };
}

export function _resetRouterHealth() {
    for (const name of ['custom', 'gemini']) {
        healthMonitor.markSuccess(name);
    }
}
