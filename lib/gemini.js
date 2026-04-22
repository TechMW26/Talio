import sharp from 'sharp';

const CUSTOM_AI_BASE_URL = process.env.CUSTOM_AI_BASE_URL?.replace(/\/$/, '');
const CUSTOM_AI_APP_TOKEN = process.env.CUSTOM_AI_APP_TOKEN || process.env.CUSTOM_AI_TOKEN;
const CUSTOM_AI_API_KEY = process.env.CUSTOM_AI_API_KEY;
const CUSTOM_AI_PUBLIC_PATH = process.env.CUSTOM_AI_PUBLIC_PATH || '/public/analyze';
const CUSTOM_AI_PROTECTED_PATH = process.env.CUSTOM_AI_PROTECTED_PATH || '/v1/analyze';

const CONTACT_SHEET_TILE_WIDTH = 960;
const CONTACT_SHEET_TILE_HEIGHT = 720;
const CONTACT_SHEET_GAP = 24;
const CONTACT_SHEET_LABEL_HEIGHT = 48;

const CUSTOM_AI_CONFIG_ERROR = 'Custom AI service is not configured. Set CUSTOM_AI_BASE_URL and either CUSTOM_AI_API_KEY or CUSTOM_AI_APP_TOKEN.';

function buildCombinedPrompt(prompt, systemInstruction = '') {
    return [systemInstruction, prompt].filter(Boolean).join('\n\n');
}

function getCustomAIConfig() {
    if (!CUSTOM_AI_BASE_URL) {
        return null;
    }

    if (CUSTOM_AI_API_KEY) {
        return {
            url: `${CUSTOM_AI_BASE_URL}${CUSTOM_AI_PROTECTED_PATH}`,
            headerName: 'X-API-KEY',
            token: CUSTOM_AI_API_KEY,
            mode: 'protected'
        };
    }

    if (CUSTOM_AI_APP_TOKEN) {
        return {
            url: `${CUSTOM_AI_BASE_URL}${CUSTOM_AI_PUBLIC_PATH}`,
            headerName: 'X-App-Token',
            token: CUSTOM_AI_APP_TOKEN,
            mode: 'public'
        };
    }

    return null;
}

function requireCustomAIConfig() {
    const config = getCustomAIConfig();
    if (!config) {
        throw new Error(CUSTOM_AI_CONFIG_ERROR);
    }

    return config;
}

function isContentPolicyError(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return (
        lower.includes('unable to') ||
        lower.includes('cannot analyze') ||
        lower.includes('cannot process') ||
        lower.includes('cannot identify') ||
        lower.includes("can't analyze") ||
        lower.includes("i'm sorry") ||
        lower.includes('content policy') ||
        lower.includes('safety') ||
        lower.includes('inappropriate') ||
        lower.includes('not allowed') ||
        lower.includes('violates') ||
        lower.includes('harmful') ||
        lower.includes('blocked')
    );
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

async function executeCustomAIRequest(prompt, upload = null) {
    const customAIConfig = requireCustomAIConfig();
    const formData = new FormData();
    formData.append('prompt', prompt);

    if (upload) {
        formData.append('file', new Blob([upload.buffer], { type: upload.mimeType }), upload.filename);
    }

    const response = await fetch(customAIConfig.url, {
        method: 'POST',
        headers: {
            [customAIConfig.headerName]: customAIConfig.token
        },
        body: formData
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Custom AI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const result = getCustomAIResult(data);

    if (isContentPolicyError(result)) {
        throw new Error('Custom AI returned a blocked response');
    }

    return result;
}

async function generateCustomAIContent(prompt, systemInstruction = '') {
    const customAIConfig = requireCustomAIConfig();
    console.log(`🧠 Trying Custom AI (${customAIConfig.mode}) for text generation...`);

    const result = await executeCustomAIRequest(buildCombinedPrompt(prompt, systemInstruction));
    console.log(`✅ Custom AI (${customAIConfig.mode}) succeeded for text generation`);
    return result;
}

function buildScreenshotLabel(index) {
    return Buffer.from(`
    <svg width="${CONTACT_SHEET_TILE_WIDTH}" height="${CONTACT_SHEET_LABEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#E2E8F0" rx="12" ry="12" />
      <text x="20" y="31" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="#0F172A">
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
                background: '#FFFFFF'
            })
            .png()
            .toBuffer({ resolveWithObject: true });

        return {
            buffer: data,
            width: info.width,
            height: info.height,
            index
        };
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

        composites.push({
            input: buildScreenshotLabel(image.index),
            left,
            top
        });

        composites.push({
            input: image.buffer,
            left: left + Math.floor((CONTACT_SHEET_TILE_WIDTH - image.width) / 2),
            top: top + CONTACT_SHEET_LABEL_HEIGHT + Math.floor((CONTACT_SHEET_TILE_HEIGHT - image.height) / 2)
        });
    });

    return sharp({
        create: {
            width: canvasWidth,
            height: canvasHeight,
            channels: 4,
            background: '#FFFFFF'
        }
    })
        .composite(composites)
        .png()
        .toBuffer();
}

async function buildCustomVisionUpload(images = []) {
    if (images.length === 0) {
        throw new Error('No images provided for Custom AI vision analysis');
    }

    if (images.length === 1) {
        const image = images[0];
        const mimeType = image.mimeType || 'image/png';
        return {
            buffer: Buffer.from(image.data, 'base64'),
            mimeType,
            filename: `analysis-image-1.${getFileExtension(mimeType)}`
        };
    }

    const contactSheetBuffer = await buildVisionContactSheet(images);
    return {
        buffer: contactSheetBuffer,
        mimeType: 'image/png',
        filename: `analysis-contact-sheet-${images.length}.png`
    };
}

async function generateCustomAIVisionContent(prompt, images = []) {
    const customAIConfig = requireCustomAIConfig();
    console.log(`🖼️ Trying Custom AI (${customAIConfig.mode}) with ${images.length} image(s)...`);

    const upload = await buildCustomVisionUpload(images);
    const result = await executeCustomAIRequest(buildCombinedPrompt(prompt), upload);

    console.log(`✅ Custom AI (${customAIConfig.mode}) succeeded for vision generation`);
    return result;
}

export async function generateContent(prompt, systemInstruction = '') {
    return generateCustomAIContent(prompt, systemInstruction);
}

export async function generateVisionContent(prompt, images = []) {
    console.log(`[Vision] Starting analysis with ${images.length} images (Custom AI only)`);
    return generateCustomAIVisionContent(prompt, images);
}

export function getAIAvailability() {
    const customAIConfig = getCustomAIConfig();

    return {
        customAI: !!customAIConfig,
        customAIMode: customAIConfig?.mode || null,
        anyAvailable: !!customAIConfig
    };
}
