// Custom AI provider. This is a faithful extraction of the original
// lib/gemini.js implementation so existing routing tests, retry semantics, and
// content-policy detection remain byte-identical. The AIProviderManager
// imports `generateCustomAIContent` / `generateCustomAIVisionContent` and
// composes them with OpenAI / Gemini fallbacks.

import sharp from 'sharp';

const CUSTOM_AI_BASE_URL = process.env.CUSTOM_AI_BASE_URL?.replace(/\/$/, '');
const CUSTOM_AI_APP_TOKEN = process.env.CUSTOM_AI_APP_TOKEN || process.env.CUSTOM_AI_TOKEN;
const CUSTOM_AI_PUBLIC_PATH = process.env.CUSTOM_AI_PUBLIC_PATH || '/public/analyze';
const CUSTOM_AI_MAX_ATTEMPTS_PER_MODE = 2;

const CONTACT_SHEET_TILE_WIDTH = 720;
const CONTACT_SHEET_TILE_HEIGHT = 540;
const CONTACT_SHEET_GAP = 20;
const CONTACT_SHEET_LABEL_HEIGHT = 40;
const CONTACT_SHEET_WEBP_QUALITY = 86;
const SINGLE_VISION_MAX_DIMENSION = 1600;
const SINGLE_VISION_MAX_BYTES = 1_500_000;
const SINGLE_VISION_WEBP_QUALITY = 88;

export const CUSTOM_AI_CONFIG_ERROR = 'Custom AI service is not configured. Set CUSTOM_AI_BASE_URL and CUSTOM_AI_APP_TOKEN.';

function buildCombinedPrompt(prompt, systemInstruction = '') {
    return [systemInstruction, prompt].filter(Boolean).join('\n\n');
}

function getCustomAIConfig() {
    const configs = getCustomAIConfigs();
    return configs[0] || null;
}

function getCustomAIConfigs() {
    if (!CUSTOM_AI_BASE_URL) return [];

    const configs = [];

    if (CUSTOM_AI_APP_TOKEN) {
        configs.push({
            url: `${CUSTOM_AI_BASE_URL}${CUSTOM_AI_PUBLIC_PATH}`,
            headerName: 'X-App-Token',
            token: CUSTOM_AI_APP_TOKEN,
            mode: 'public',
        });
    }

    return configs;
}

function requireCustomAIConfig() {
    const config = getCustomAIConfig();
    if (!config) throw new Error(CUSTOM_AI_CONFIG_ERROR);
    return config;
}

function requireCustomAIConfigs() {
    const configs = getCustomAIConfigs();
    if (configs.length === 0) throw new Error(CUSTOM_AI_CONFIG_ERROR);
    return configs;
}

function getPublicCustomAIConfig() {
    if (!CUSTOM_AI_BASE_URL || !CUSTOM_AI_APP_TOKEN) return null;
    return {
        url: `${CUSTOM_AI_BASE_URL}${CUSTOM_AI_PUBLIC_PATH}`,
        headerName: 'X-App-Token',
        token: CUSTOM_AI_APP_TOKEN,
        mode: 'public',
    };
}

function requirePublicCustomAIConfig() {
    const config = getPublicCustomAIConfig();
    if (!config) {
        const error = new Error('Custom AI public mode is not configured. Set CUSTOM_AI_BASE_URL and CUSTOM_AI_APP_TOKEN.');
        error.errorClass = 'unconfigured';
        throw error;
    }
    return config;
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

function getCustomAIResult(data) {
    if (!data?.success || typeof data.result !== 'string' || !data.result.trim()) {
        throw new Error('Custom AI returned an invalid response');
    }
    return data.result;
}

function buildCustomAIFormData(prompt, upload = null) {
    const formData = new FormData();
    formData.append('prompt', prompt);
    if (upload) {
        formData.append('file', new Blob([upload.buffer], { type: upload.mimeType }), upload.filename);
    }
    return formData;
}

function createCustomAIRequestError(customAIConfig, status, errorText) {
    const error = new Error(`Custom AI API error: ${status} - ${errorText}`);
    error.status = status;
    error.mode = customAIConfig.mode;
    error.errorClass = status === 429 ? 'rate_limit' : status >= 500 ? 'server' : 'client';
    error.isRetryable = status === 429 || status >= 500 || `${errorText}`.toLowerCase().includes('gpu engine error');
    return error;
}

function isCustomAIHostUnreachable(error) {
    const code = `${error?.code || ''}`.toUpperCase();
    return [
        'ECONNREFUSED',
        'ENOTFOUND',
        'EHOSTUNREACH',
        'EAI_AGAIN',
        'ETIMEDOUT',
        'UND_ERR_CONNECT_TIMEOUT',
    ].includes(code);
}

function isRetryableCustomAIError(error) {
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

async function executeSingleCustomAIRequest(customAIConfig, prompt, upload = null) {
    const formData = buildCustomAIFormData(prompt, upload);
    let response;

    try {
        response = await fetch(customAIConfig.url, {
            method: 'POST',
            headers: { [customAIConfig.headerName]: customAIConfig.token },
            body: formData,
        });
    } catch (error) {
        const causeCode = error?.cause?.code || error?.code || 'NETWORK_ERROR';
        const causeMessage = error?.cause?.message || error?.message || 'Unknown network error';
        const networkError = new Error(`Custom AI service unreachable (${causeCode}): ${causeMessage}`);
        networkError.mode = customAIConfig.mode;
        networkError.code = causeCode;
        networkError.errorClass = 'network';
        networkError.isHostUnreachable = isCustomAIHostUnreachable({ code: causeCode });
        networkError.isRetryable = true;
        networkError.cause = error;
        throw networkError;
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw createCustomAIRequestError(customAIConfig, response.status, errorText);
    }

    const data = await response.json();
    const result = getCustomAIResult(data);

    if (isContentPolicyError(result)) {
        const error = new Error('Custom AI returned a blocked response');
        error.isContentPolicyError = true;
        error.mode = customAIConfig.mode;
        throw error;
    }

    return result;
}

async function executeCustomAIRequest(prompt, upload = null) {
    const customAIConfigs = requireCustomAIConfigs();
    let lastError = null;

    for (let index = 0; index < customAIConfigs.length; index += 1) {
        const customAIConfig = customAIConfigs[index];

        for (let attempt = 1; attempt <= CUSTOM_AI_MAX_ATTEMPTS_PER_MODE; attempt += 1) {
            try {
                const result = await executeSingleCustomAIRequest(customAIConfig, prompt, upload);
                return { result, customAIConfig, attempt };
            } catch (error) {
                lastError = error;

                if (error.isHostUnreachable) {
                    throw error;
                }

                const hasAlternateConfig = index < customAIConfigs.length - 1;
                const shouldRetryCurrentMode = attempt < CUSTOM_AI_MAX_ATTEMPTS_PER_MODE && isRetryableCustomAIError(error);

                if (shouldRetryCurrentMode) {
                    console.warn(`⚠️ Custom AI (${customAIConfig.mode}) attempt ${attempt} failed: ${error.message}. Retrying...`);
                    continue;
                }

                if (hasAlternateConfig) {
                    console.warn(`⚠️ Custom AI (${customAIConfig.mode}) failed: ${error.message}. Falling back to ${customAIConfigs[index + 1].mode}...`);
                    break;
                }

                throw error;
            }
        }
    }

    throw lastError || new Error('Custom AI request failed');
}

export async function generateCustomAIContent(prompt, systemInstruction = '') {
    const customAIConfig = requireCustomAIConfig();
    console.log(`🧠 Trying Custom AI (${customAIConfig.mode}) for text generation...`);

    const { result, customAIConfig: resolvedConfig, attempt } = await executeCustomAIRequest(buildCombinedPrompt(prompt, systemInstruction));
    console.log(`✅ Custom AI (${resolvedConfig.mode}) succeeded for text generation${attempt > 1 ? ` after ${attempt} attempts` : ''}`);
    return result;
}

export async function generateCustomAIPublicContent(prompt, systemInstruction = '') {
    const publicConfig = requirePublicCustomAIConfig();
    console.log('🧠 Trying Custom AI (public) for text generation...');

    const combinedPrompt = buildCombinedPrompt(prompt, systemInstruction);
    let lastError = null;

    for (let attempt = 1; attempt <= CUSTOM_AI_MAX_ATTEMPTS_PER_MODE; attempt += 1) {
        try {
            const result = await executeSingleCustomAIRequest(publicConfig, combinedPrompt);
            console.log(`✅ Custom AI (public) succeeded for text generation${attempt > 1 ? ` after ${attempt} attempts` : ''}`);
            return result;
        } catch (error) {
            lastError = error;
            if (!isRetryableCustomAIError(error) || attempt >= CUSTOM_AI_MAX_ATTEMPTS_PER_MODE) {
                throw error;
            }
            console.warn(`⚠️ Custom AI (public) attempt ${attempt} failed: ${error.message}. Retrying...`);
        }
    }

    throw lastError || new Error('Custom AI public request failed');
}

function buildScreenshotLabel(index) {
    return Buffer.from(`
    <svg width="${CONTACT_SHEET_TILE_WIDTH}" height="${CONTACT_SHEET_LABEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#E2E8F0" rx="12" ry="12" />
            <text x="18" y="27" font-family="Arial, sans-serif" font-size="18" font-weight="600" fill="#0F172A">
        Screenshot ${index + 1}
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

async function buildCustomVisionUpload(images = []) {
    if (images.length === 0) {
        throw new Error('No images provided for Custom AI vision analysis');
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

export async function generateCustomAIVisionContent(prompt, images = []) {
    const customAIConfig = requireCustomAIConfig();
    console.log(`🖼️ Trying Custom AI (${customAIConfig.mode}) with ${images.length} image(s)...`);

    const upload = await buildCustomVisionUpload(images);
    const { result, customAIConfig: resolvedConfig, attempt } = await executeCustomAIRequest(buildCombinedPrompt(prompt), upload);

    console.log(`✅ Custom AI (${resolvedConfig.mode}) succeeded for vision generation${attempt > 1 ? ` after ${attempt} attempts` : ''}`);
    return result;
}

export function getCustomAIAvailability() {
    const customAIConfig = getCustomAIConfig();
    return {
        configured: !!customAIConfig,
        mode: customAIConfig?.mode || null,
    };
}

export function isCustomAIConfigError(error) {
    return error?.message === CUSTOM_AI_CONFIG_ERROR;
}
