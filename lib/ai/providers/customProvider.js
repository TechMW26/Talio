// Custom AI provider. This is a faithful extraction of the original
// lib/gemini.js implementation so existing routing tests, retry semantics, and
// content-policy detection remain byte-identical. The AIProviderManager
// imports `generateCustomAIContent` / `generateCustomAIVisionContent` and
// composes them with Inference + Gemini fallbacks.
//
// As of 2026-04 the same protocol is used by a second remote service
// ("Inference"). To avoid duplicating ~400 lines of contact-sheet / retry /
// refusal-detection logic we expose the underlying engine as a factory keyed
// on a service profile (env-var prefix). The public exports below stay 1:1
// compatible with existing call sites.

import sharp from 'sharp';

const CUSTOM_AI_MAX_ATTEMPTS_PER_MODE = 2;

// Contact-sheet tiles must be large enough for the vision model to actually
// read on-screen text, code, URLs and timestamps. Previous defaults of
// 720x540 produced unreadable thumbnails when 10+ screenshots were combined,
// causing the model to hallucinate plausible-sounding analysis. The new
// defaults trade payload size for genuinely legible tiles.
const CONTACT_SHEET_TILE_WIDTH = 1600;
const CONTACT_SHEET_TILE_HEIGHT = 1000;
const CONTACT_SHEET_GAP = 18;
const CONTACT_SHEET_LABEL_HEIGHT = 52;
const CONTACT_SHEET_WEBP_QUALITY = 92;
const SINGLE_VISION_MAX_DIMENSION = 1600;
const SINGLE_VISION_MAX_BYTES = 1_500_000;
const SINGLE_VISION_WEBP_QUALITY = 88;

export const CUSTOM_AI_CONFIG_ERROR = 'Custom AI service is not configured. Set CUSTOM_AI_BASE_URL and either CUSTOM_AI_API_KEY or CUSTOM_AI_APP_TOKEN.';
export const INFERENCE_CONFIG_ERROR = 'Inference AI service is not configured. Set INFERENCE_BASE_URL and either INFERENCE_API_KEY or INFERENCE_APP_TOKEN.';

// ---------------------------------------------------------------------------
// Service profiles (Custom AI primary, Inference secondary)
// ---------------------------------------------------------------------------

const SERVICE_PROFILES = {
    custom: {
        label: 'Custom AI',
        configError: CUSTOM_AI_CONFIG_ERROR,
        baseUrl: () => (process.env.CUSTOM_AI_BASE_URL || '').replace(/\/$/, ''),
        apiKey: () => process.env.CUSTOM_AI_API_KEY,
        protectedPath: () => process.env.CUSTOM_AI_PROTECTED_PATH || '/v1/analyze',
        appToken: () => process.env.CUSTOM_AI_APP_TOKEN || process.env.CUSTOM_AI_TOKEN,
        publicPath: () => process.env.CUSTOM_AI_PUBLIC_PATH || '/public/analyze',
    },
    inference: {
        label: 'Inference AI',
        configError: INFERENCE_CONFIG_ERROR,
        baseUrl: () => (process.env.INFERENCE_BASE_URL || '').replace(/\/$/, ''),
        apiKey: () => process.env.INFERENCE_API_KEY,
        protectedPath: () => process.env.INFERENCE_PROTECTED_PATH || '/v1/analyze',
        appToken: () => process.env.INFERENCE_APP_TOKEN || process.env.INFERENCE_TOKEN,
        publicPath: () => process.env.INFERENCE_PUBLIC_PATH || '/public/analyze',
    },
};

function buildCombinedPrompt(prompt, systemInstruction = '') {
    return [systemInstruction, prompt].filter(Boolean).join('\n\n');
}

function buildServiceConfig(profile, serviceKey, baseUrl, mode, headerName, token, path) {
    if (!token) return null;
    return {
        url: `${baseUrl}${path}`,
        headerName,
        token,
        mode,
        label: profile.label,
        serviceKey,
    };
}

function getServiceConfigs(serviceKey) {
    const profile = SERVICE_PROFILES[serviceKey];
    if (!profile) return [];
    const baseUrl = profile.baseUrl();
    if (!baseUrl) return [];

    return [
        buildServiceConfig(profile, serviceKey, baseUrl, 'protected', 'X-API-KEY', profile.apiKey(), profile.protectedPath()),
        buildServiceConfig(profile, serviceKey, baseUrl, 'public', 'X-App-Token', profile.appToken(), profile.publicPath()),
    ].filter(Boolean);
}

function getServiceConfig(serviceKey) {
    return getServiceConfigs(serviceKey)[0] || null;
}

function requireServiceConfig(serviceKey) {
    const cfg = getServiceConfig(serviceKey);
    if (!cfg) {
        const error = new Error(SERVICE_PROFILES[serviceKey]?.configError || 'AI service is not configured.');
        error.errorClass = 'unconfigured';
        throw error;
    }
    return cfg;
}

function requireServiceConfigs(serviceKey) {
    const configs = getServiceConfigs(serviceKey);
    if (configs.length === 0) {
        const error = new Error(SERVICE_PROFILES[serviceKey]?.configError || 'AI service is not configured.');
        error.errorClass = 'unconfigured';
        throw error;
    }
    return configs;
}

// Detects only clear, model-issued refusal responses. Long structured outputs
// (JSON, mindmaps, code) must NOT be flagged just because they include words
// like "safety", "blocked", or "harmful".
function isContentPolicyError(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (trimmed.length > 600) return false;
    if (/[{}\[\]]/.test(trimmed)) return false;
    if (trimmed.includes('```')) return false;

    const head = trimmed.slice(0, 200).toLowerCase();
    const refusalPrefixes = [
        "i'm sorry", 'i am sorry', 'sorry, i ', "sorry, i'",
        "i can't ", 'i cannot ', 'i am unable to', "i'm unable to",
        'i am not able to', "i'm not able to",
        'as an ai', 'as a language model',
        'i do not have the ability', "i don't have the ability",
    ];

    return refusalPrefixes.some(prefix => head.startsWith(prefix) || head.includes(`. ${prefix}`));
}

function getFileExtension(mimeType = 'image/png') {
    if (mimeType.includes('png')) return 'png';
    if (mimeType.includes('webp')) return 'webp';
    if (mimeType.includes('gif')) return 'gif';
    if (mimeType.includes('svg')) return 'svg';
    return 'jpg';
}

function getServiceResult(label, data) {
    if (!data?.success || typeof data.result !== 'string' || !data.result.trim()) {
        throw new Error(`${label} returned an invalid response`);
    }
    return data.result;
}

function buildServiceFormData(prompt, upload = null) {
    const formData = new FormData();
    formData.append('prompt', prompt);
    if (upload) {
        formData.append('file', new Blob([upload.buffer], { type: upload.mimeType }), upload.filename);
    }
    return formData;
}

function createServiceRequestError(label, serviceConfig, status, errorText) {
    const error = new Error(`${label} API error: ${status} - ${errorText}`);
    error.status = status;
    error.mode = serviceConfig.mode;
    error.errorClass = status === 429 ? 'rate_limit' : status >= 500 ? 'server' : 'client';
    error.isRetryable = status === 429 || status >= 500 || `${errorText}`.toLowerCase().includes('gpu engine error');
    return error;
}

function isHostUnreachableCode(code) {
    const upper = `${code || ''}`.toUpperCase();
    return [
        'ECONNREFUSED',
        'ENOTFOUND',
        'EHOSTUNREACH',
        'EAI_AGAIN',
        'ETIMEDOUT',
        'UND_ERR_CONNECT_TIMEOUT',
    ].includes(upper);
}

function isRetryableServiceError(error) {
    if (!error) return false;
    if (error.isContentPolicyError) return false;
    if (error.isRetryable) return true;

    const message = `${error.message || ''}`.toLowerCase();
    return (
        message.includes('gpu engine error') ||
        message.includes('fetch failed') ||
        message.includes('timed out') ||
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('temporarily unavailable')
    );
}

async function executeSingleServiceRequest(serviceConfig, prompt, upload = null) {
    const formData = buildServiceFormData(prompt, upload);
    let response;

    try {
        response = await fetch(serviceConfig.url, {
            method: 'POST',
            headers: { [serviceConfig.headerName]: serviceConfig.token },
            body: formData,
        });
    } catch (error) {
        const causeCode = error?.cause?.code || error?.code || 'NETWORK_ERROR';
        const causeMessage = error?.cause?.message || error?.message || 'Unknown network error';
        const networkError = new Error(`${serviceConfig.label} service unreachable (${causeCode}): ${causeMessage}`);
        networkError.mode = serviceConfig.mode;
        networkError.code = causeCode;
        networkError.errorClass = 'network';
        networkError.isHostUnreachable = isHostUnreachableCode(causeCode);
        networkError.isRetryable = true;
        networkError.cause = error;
        throw networkError;
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw createServiceRequestError(serviceConfig.label, serviceConfig, response.status, errorText);
    }

    const data = await response.json();
    const result = getServiceResult(serviceConfig.label, data);

    if (isContentPolicyError(result)) {
        const error = new Error(`${serviceConfig.label} returned a blocked response`);
        error.isContentPolicyError = true;
        error.mode = serviceConfig.mode;
        throw error;
    }

    return result;
}

async function executeServiceRequest(serviceKey, prompt, upload = null) {
    const serviceConfigs = requireServiceConfigs(serviceKey);
    let lastError = null;

    for (let index = 0; index < serviceConfigs.length; index += 1) {
        const serviceConfig = serviceConfigs[index];

        for (let attempt = 1; attempt <= CUSTOM_AI_MAX_ATTEMPTS_PER_MODE; attempt += 1) {
            try {
                const result = await executeSingleServiceRequest(serviceConfig, prompt, upload);
                return { result, serviceConfig, attempt };
            } catch (error) {
                lastError = error;

                if (error.isHostUnreachable) {
                    throw error;
                }

                const hasAlternateConfig = index < serviceConfigs.length - 1;
                const shouldRetryCurrentMode = attempt < CUSTOM_AI_MAX_ATTEMPTS_PER_MODE && isRetryableServiceError(error);

                if (shouldRetryCurrentMode) {
                    console.warn(`⚠️ ${serviceConfig.label} (${serviceConfig.mode}) attempt ${attempt} failed: ${error.message}. Retrying...`);
                    continue;
                }

                if (hasAlternateConfig) {
                    console.warn(`⚠️ ${serviceConfig.label} (${serviceConfig.mode}) failed: ${error.message}. Falling back to ${serviceConfigs[index + 1].mode}...`);
                    break;
                }

                throw error;
            }
        }
    }

    throw lastError || new Error('AI service request failed');
}

// ---------------------------------------------------------------------------
// Vision helpers (contact-sheet / single-image normalization). Service-agnostic.
// ---------------------------------------------------------------------------

function buildScreenshotLabel(index) {
    return Buffer.from(`
    <svg width="${CONTACT_SHEET_TILE_WIDTH}" height="${CONTACT_SHEET_LABEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#0F172A" rx="10" ry="10" />
            <text x="22" y="35" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#FFFFFF">
        SCREENSHOT ${index + 1}
      </text>
    </svg>
  `);
}

async function buildVisionContactSheet(images) {
    const columns = images.length <= 2 ? 1 : 2;
    const rows = Math.ceil(images.length / columns);
    const preparedImages = await Promise.all(images.map(async (image, index) => {
        const imageBuffer = Buffer.from(image.data, 'base64');
        const { data, info } = await sharp(imageBuffer)
            .rotate()
            .resize({
                width: CONTACT_SHEET_TILE_WIDTH,
                height: CONTACT_SHEET_TILE_HEIGHT,
                fit: 'inside',
                withoutEnlargement: true,
                background: '#FFFFFF',
            })
            .webp({ quality: CONTACT_SHEET_WEBP_QUALITY })
            .toBuffer({ resolveWithObject: true });

        return { buffer: data, width: info.width, height: info.height, index };
    }));

    const cellHeight = CONTACT_SHEET_TILE_HEIGHT + CONTACT_SHEET_LABEL_HEIGHT;
    const canvasWidth = (columns * CONTACT_SHEET_TILE_WIDTH) + ((columns + 1) * CONTACT_SHEET_GAP);
    const canvasHeight = (rows * cellHeight) + ((rows + 1) * CONTACT_SHEET_GAP);
    const composites = [];

    preparedImages.forEach((image, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const left = CONTACT_SHEET_GAP + (column * (CONTACT_SHEET_TILE_WIDTH + CONTACT_SHEET_GAP));
        const top = CONTACT_SHEET_GAP + (row * (cellHeight + CONTACT_SHEET_GAP));

        composites.push({ input: buildScreenshotLabel(image.index), left, top });
        composites.push({
            input: image.buffer,
            left: left + Math.floor((CONTACT_SHEET_TILE_WIDTH - image.width) / 2),
            top: top + CONTACT_SHEET_LABEL_HEIGHT + Math.floor((CONTACT_SHEET_TILE_HEIGHT - image.height) / 2),
        });
    });

    return sharp({
        create: { width: canvasWidth, height: canvasHeight, channels: 4, background: '#FFFFFF' },
    })
        .composite(composites)
        .webp({ quality: CONTACT_SHEET_WEBP_QUALITY })
        .toBuffer();
}

async function buildSingleVisionUpload(image, index = 1) {
    const mimeType = image.mimeType || 'image/png';
    const originalBuffer = Buffer.from(image.data, 'base64');
    const fallbackUpload = {
        buffer: originalBuffer,
        mimeType,
        filename: `analysis-image-${index}.${getFileExtension(mimeType)}`,
    };

    try {
        const pipeline = sharp(originalBuffer, { failOnError: false }).rotate();
        const metadata = await pipeline.metadata();
        const width = metadata.width || 0;
        const height = metadata.height || 0;
        const shouldNormalize =
            mimeType.includes('svg') ||
            originalBuffer.length > SINGLE_VISION_MAX_BYTES ||
            width > SINGLE_VISION_MAX_DIMENSION ||
            height > SINGLE_VISION_MAX_DIMENSION;

        if (!shouldNormalize) return fallbackUpload;

        const normalizedBuffer = await pipeline
            .resize({
                width: SINGLE_VISION_MAX_DIMENSION,
                height: SINGLE_VISION_MAX_DIMENSION,
                fit: 'inside',
                withoutEnlargement: true,
                background: '#FFFFFF',
            })
            .webp({ quality: SINGLE_VISION_WEBP_QUALITY })
            .toBuffer();

        return {
            buffer: normalizedBuffer,
            mimeType: 'image/webp',
            filename: `analysis-image-${index}.webp`,
        };
    } catch (error) {
        console.warn(`[Vision] Failed to optimize image ${index} before upload: ${error.message}`);
        return fallbackUpload;
    }
}

async function buildServiceVisionUpload(label, images = []) {
    if (images.length === 0) {
        throw new Error(`No images provided for ${label} vision analysis`);
    }
    if (images.length === 1) {
        return buildSingleVisionUpload(images[0], 1);
    }
    const contactSheetBuffer = await buildVisionContactSheet(images);
    return {
        buffer: contactSheetBuffer,
        mimeType: 'image/webp',
        filename: `analysis-contact-sheet-${images.length}.webp`,
    };
}

// ---------------------------------------------------------------------------
// Generic factory — bind a service profile to text + vision generators.
// ---------------------------------------------------------------------------

function createServiceGenerators(serviceKey) {
    const label = SERVICE_PROFILES[serviceKey].label;

    async function generateContent(prompt, systemInstruction = '') {
        const cfg = requireServiceConfig(serviceKey);
        console.log(`🧠 Trying ${cfg.label} (${cfg.mode}) for text generation...`);
        const { result, serviceConfig: resolved, attempt } = await executeServiceRequest(serviceKey, buildCombinedPrompt(prompt, systemInstruction));
        console.log(`✅ ${resolved.label} (${resolved.mode}) succeeded for text generation${attempt > 1 ? ` after ${attempt} attempts` : ''}`);
        return result;
    }

    async function generateVisionContent(prompt, images = []) {
        const cfg = requireServiceConfig(serviceKey);
        console.log(`🖼️ Trying ${cfg.label} (${cfg.mode}) with ${images.length} image(s)...`);
        const upload = await buildServiceVisionUpload(label, images);
        const { result, serviceConfig: resolved, attempt } = await executeServiceRequest(serviceKey, buildCombinedPrompt(prompt), upload);
        console.log(`✅ ${resolved.label} (${resolved.mode}) succeeded for vision generation${attempt > 1 ? ` after ${attempt} attempts` : ''}`);
        return result;
    }

    /**
     * Vision call that uploads a pre-built image buffer AS-IS — no
     * contact-sheet construction, no shrinking. Used by the productivity
     * pipeline which builds its own optimized stitched composite and wants
     * the model to see it at full resolution.
     */
    async function generateRawVisionContent(prompt, { buffer, mimeType = 'image/webp', filename } = {}) {
        if (!buffer || !buffer.length) {
            throw new Error(`${label} raw vision call requires a non-empty buffer`);
        }
        requireServiceConfig(serviceKey);
        const upload = {
            buffer,
            mimeType,
            filename: filename || `analysis-stitched.${getFileExtension(mimeType)}`,
        };
        console.log(`🖼️ Trying ${label} raw vision (${(buffer.length / 1024).toFixed(0)} KB ${mimeType})...`);
        const { result, serviceConfig: resolved, attempt } = await executeServiceRequest(serviceKey, buildCombinedPrompt(prompt), upload);
        console.log(`✅ ${resolved.label} (${resolved.mode}) succeeded for raw vision${attempt > 1 ? ` after ${attempt} attempts` : ''}`);
        return result;
    }

    function getAvailability() {
        const cfg = getServiceConfig(serviceKey);
        return { configured: !!cfg, mode: cfg?.mode || null };
    }

    return { generateContent, generateVisionContent, generateRawVisionContent, getAvailability };
}

// ---------------------------------------------------------------------------
// Public exports — Custom AI (legacy) + Inference (new) + back-compat helpers.
// ---------------------------------------------------------------------------

const customAI = createServiceGenerators('custom');
const inferenceAI = createServiceGenerators('inference');

export const generateCustomAIContent = customAI.generateContent;
export const generateCustomAIVisionContent = customAI.generateVisionContent;
export const generateCustomAIRawVisionContent = customAI.generateRawVisionContent;
export const getCustomAIAvailability = customAI.getAvailability;

export const generateInferenceContent = inferenceAI.generateContent;
export const generateInferenceVisionContent = inferenceAI.generateVisionContent;
export const generateInferenceRawVisionContent = inferenceAI.generateRawVisionContent;
export const getInferenceAvailability = inferenceAI.getAvailability;

export function isCustomAIConfigError(error) {
    return error?.message === CUSTOM_AI_CONFIG_ERROR;
}

export function isInferenceConfigError(error) {
    return error?.message === INFERENCE_CONFIG_ERROR;
}

// Back-compat: the original module exposed a "public-only" text helper used by
// a couple of call sites that explicitly wanted to bypass the protected mode.
// Public mode is now the only mode, so this is just an alias.
export const generateCustomAIPublicContent = customAI.generateContent;
