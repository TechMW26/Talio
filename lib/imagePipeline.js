/**
 * Unified image-processing pipeline.
 *
 * This is the canonical entry point for ALL inbound user images:
 *  - profile pictures
 *  - aadhaar / KYC documents
 *  - desktop-app screenshots
 *  - generic uploads
 *  - chat / project / meeting attachments
 *
 * Internally delegates to lib/imageOptimization.js for the sharp work, and
 * adds the policy layer: per-type size caps, mandatory EXIF strip, mandatory
 * WebP output, dimension caps, and a single error shape callers can rely on.
 *
 * Usage:
 *   const result = await processImage(buffer, { type: 'screenshot' });
 *   // result.buffer, result.mimeType ('image/webp'), result.width, result.height,
 *   // result.bytes, result.originalBytes, result.compressionRatio
 *
 * If the input exceeds the per-type size cap before processing, a typed error
 * is thrown ({ name: 'ImagePipelineError', code: 'too_large' }).
 */

import { optimizeImage } from './imageOptimization';

/**
 * Per-type policy. Tweak via env (e.g. PIPELINE_SCREENSHOT_MAX_BYTES).
 *  - maxBytes: hard cap on input buffer; oversize => reject (DoS protection)
 *  - dimType : key into imageOptimization OPTIMIZATION_CONFIG.maxDimensions
 *  - quality : 1-100 (lower = smaller file)
 */
const POLICIES = {
    avatar: { maxBytes: 5 * 1024 * 1024, dimType: 'avatar', quality: 85 },
    document: { maxBytes: 8 * 1024 * 1024, dimType: 'large', quality: 80 },
    screenshot: { maxBytes: 8 * 1024 * 1024, dimType: 'screenshot', quality: 70 },
    attachment: { maxBytes: 10 * 1024 * 1024, dimType: 'large', quality: 80 },
    thumbnail: { maxBytes: 2 * 1024 * 1024, dimType: 'thumbnail', quality: 70 },
    generic: { maxBytes: 10 * 1024 * 1024, dimType: 'medium', quality: 80 },
};

function envInt(name, fallback) {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
}

function getPolicy(type) {
    const base = POLICIES[type] || POLICIES.generic;
    const upperType = String(type || 'generic').toUpperCase();
    return {
        maxBytes: envInt(`PIPELINE_${upperType}_MAX_BYTES`, base.maxBytes),
        dimType: base.dimType,
        quality: envInt(`PIPELINE_${upperType}_QUALITY`, base.quality),
    };
}

export class ImagePipelineError extends Error {
    constructor(code, message, meta = {}) {
        super(message);
        this.name = 'ImagePipelineError';
        this.code = code;
        this.meta = meta;
    }
}

/**
 * @param {Buffer} buffer
 * @param {object} [options]
 * @param {keyof typeof POLICIES} [options.type='generic']
 * @param {string} [options.format='webp']  output format
 * @param {boolean}[options.preserveAnimation=false]
 * @returns {Promise<{
 *   buffer: Buffer, mimeType: string, width: number, height: number,
 *   bytes: number, originalBytes: number, compressionRatio: number, format: string
 * }>}
 */
export async function processImage(buffer, options = {}) {
    if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
        throw new ImagePipelineError('invalid_input', 'processImage requires a Buffer');
    }
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    const { type = 'generic', format = 'webp' } = options;
    const policy = getPolicy(type);

    if (buf.length > policy.maxBytes) {
        throw new ImagePipelineError('too_large', `Image exceeds ${policy.maxBytes} byte limit for type "${type}"`, {
            actualBytes: buf.length,
            maxBytes: policy.maxBytes,
            type,
        });
    }

    const result = await optimizeImage(buf, {
        type: policy.dimType,
        format,
        quality: policy.quality,
        preserveExif: false,
    });

    if (!result?.buffer) {
        throw new ImagePipelineError('processing_failed', 'Image processing returned no buffer');
    }

    const meta = result.metadata || {};
    return {
        buffer: result.buffer,
        mimeType: `image/${format}`,
        width: meta.width || 0,
        height: meta.height || 0,
        bytes: result.buffer.length,
        originalBytes: buf.length,
        compressionRatio: buf.length > 0 ? Number((result.buffer.length / buf.length).toFixed(3)) : 1,
        format,
    };
}

/**
 * Convenience guard: returns true if the mime type looks like a known image.
 */
export function isImageMime(mime) {
    if (typeof mime !== 'string') return false;
    return /^image\/(png|jpe?g|webp|gif|avif|heic|heif|bmp|tiff?)$/i.test(mime);
}
