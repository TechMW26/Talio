import ImageKit from 'imagekit';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

// Initialize ImageKit instance
let imagekitInstance = null;

/**
 * Generate a sanitized folder name from employee info
 * @param {Object} employee - Employee object with firstName, lastName, employeeCode
 * @returns {string} Sanitized folder name like "JohnDoe-EMP001"
 */
export function generateEmployeeFolderName(employee) {
    if (!employee) return 'unknown';

    const firstName = (employee.firstName || '').replace(/[^a-zA-Z0-9]/g, '');
    const lastName = (employee.lastName || '').replace(/[^a-zA-Z0-9]/g, '');
    const employeeCode = (employee.employeeCode || '').replace(/[^a-zA-Z0-9-]/g, '');

    const name = `${firstName}${lastName}`.trim() || 'Unknown';
    const code = employeeCode || 'NOCODE';

    return `${name}-${code}`;
}

/**
 * ImageKit folder structure:
 * /chat/{EmployeeName-EmployeeCode}/           - Chat images
 * /profiles/{EmployeeName-EmployeeCode}/       - Profile pictures
 * /aadhaar/{EmployeeName-EmployeeCode}/        - Aadhaar documents
 * /screenshots/{EmployeeName-EmployeeCode}/{date}/ - Screenshots
 * /companies/logos/                            - Company logos
 * /whiteboards/{whiteboardId}/                 - Whiteboard thumbnails
 * /settings/                                   - System settings (logo, etc.)
 */
export const IMAGEKIT_FOLDERS = {
    CHAT: '/chat',
    PROFILES: '/profiles',
    AADHAAR: '/aadhaar',
    SCREENSHOTS: '/screenshots',
    COMPANIES: '/companies/logos',
    WHITEBOARDS: '/whiteboards',
    SETTINGS: '/settings',
};

/**
 * Get the ImageKit folder path for a specific type
 * @param {string} type - Type of upload (chat, profile, aadhaar, screenshot, etc.)
 * @param {Object} options - Options containing employee info
 * @param {Object} options.employee - Employee object
 * @param {string} options.dateString - Date string for screenshots (YYYY-MM-DD)
 * @param {string} options.whiteboardId - Whiteboard ID for whiteboard thumbnails
 * @param {string} options.companyCode - Company code for company logos
 * @returns {string} Full folder path
 */
export function getImageKitFolder(type, options = {}) {
    const { employee, dateString, whiteboardId, companyCode } = options;
    const employeeFolder = generateEmployeeFolderName(employee);

    switch (type) {
        case 'chat':
            return `${IMAGEKIT_FOLDERS.CHAT}/${employeeFolder}`;
        case 'profile':
            return `${IMAGEKIT_FOLDERS.PROFILES}/${employeeFolder}`;
        case 'aadhaar':
            return `${IMAGEKIT_FOLDERS.AADHAAR}/${employeeFolder}`;
        case 'screenshot':
            return `${IMAGEKIT_FOLDERS.SCREENSHOTS}/${employeeFolder}${dateString ? `/${dateString}` : ''}`;
        case 'company':
            return companyCode
                ? `${IMAGEKIT_FOLDERS.COMPANIES}/${companyCode}`
                : IMAGEKIT_FOLDERS.COMPANIES;
        case 'whiteboard':
            return whiteboardId
                ? `${IMAGEKIT_FOLDERS.WHITEBOARDS}/${whiteboardId}`
                : IMAGEKIT_FOLDERS.WHITEBOARDS;
        case 'settings':
            return IMAGEKIT_FOLDERS.SETTINGS;
        default:
            return `/uploads/${employeeFolder}`;
    }
}

/**
 * Get or create ImageKit instance
 * @returns {ImageKit} ImageKit instance
 */
function getImageKit() {
    if (!imagekitInstance) {
        const publicKey = process.env.IMAGEKIT_PUBLIC_KEY;
        const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
        const urlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT;

        if (!publicKey || !privateKey || !urlEndpoint) {
            throw new Error(
                'ImageKit configuration missing. Please set IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, and IMAGEKIT_URL_ENDPOINT environment variables.'
            );
        }

        imagekitInstance = new ImageKit({
            publicKey,
            privateKey,
            urlEndpoint,
        });
    }

    return imagekitInstance;
}

// Temp directory for storing files before upload
const TEMP_DIR = path.join(process.cwd(), 'temp', 'uploads');

/**
 * Ensure temp directory exists
 */
async function ensureTempDir() {
    if (!existsSync(TEMP_DIR)) {
        await fs.mkdir(TEMP_DIR, { recursive: true });
    }
    return TEMP_DIR;
}

/**
 * Save a file temporarily before uploading to ImageKit
 * @param {Buffer|string} fileData - File buffer or base64 string
 * @param {string} filename - Original filename
 * @returns {Promise<string>} Path to the temporary file
 */
export async function saveTempFile(fileData, filename) {
    await ensureTempDir();

    let buffer;
    if (typeof fileData === 'string') {
        // Handle base64 data
        const base64Data = fileData.replace(/^data:image\/\w+;base64,/, '');
        buffer = Buffer.from(base64Data, 'base64');
    } else {
        buffer = fileData;
    }

    const tempFilename = `${Date.now()}_${filename}`;
    const tempPath = path.join(TEMP_DIR, tempFilename);

    await fs.writeFile(tempPath, buffer);

    return tempPath;
}

/**
 * Delete a temporary file
 * @param {string} filePath - Path to the file to delete
 */
export async function deleteTempFile(filePath) {
    try {
        if (existsSync(filePath)) {
            await fs.unlink(filePath);
            console.log(`[ImageKit] Temp file deleted: ${filePath}`);
        }
    } catch (error) {
        console.error(`[ImageKit] Failed to delete temp file: ${filePath}`, error.message);
    }
}

/**
 * Clean up old temp files (older than 1 hour)
 * Call this periodically to prevent temp folder bloat
 */
export async function cleanupTempFiles() {
    try {
        await ensureTempDir();
        const files = await fs.readdir(TEMP_DIR);
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;

        for (const file of files) {
            const filePath = path.join(TEMP_DIR, file);
            const stat = await fs.stat(filePath);

            if (now - stat.mtimeMs > oneHour) {
                await fs.unlink(filePath);
                console.log(`[ImageKit] Cleaned up old temp file: ${file}`);
            }
        }
    } catch (error) {
        console.error('[ImageKit] Temp cleanup error:', error.message);
    }
}

/**
 * Upload image to ImageKit from a file path
 * @param {string} filePath - Path to the file to upload
 * @param {Object} options - Upload options
 * @param {string} options.folder - ImageKit folder path (e.g., '/profile-pictures')
 * @param {string} options.fileName - Custom filename (optional)
 * @param {boolean} options.useUniqueFileName - Use unique filename (default: true)
 * @param {Object} options.tags - Tags for the image
 * @param {Object} options.customMetadata - Custom metadata
 * @returns {Promise<Object>} ImageKit upload response with url, fileId, etc.
 */
export async function uploadToImageKit(filePath, options = {}) {
    const imagekit = getImageKit();

    const {
        folder = '/uploads',
        fileName = path.basename(filePath),
        useUniqueFileName = true,
        tags = [],
    } = options;

    try {
        const fileBuffer = await fs.readFile(filePath);

        // Filter out any undefined/null tags
        const safeTags = Array.isArray(tags) ? tags.filter(Boolean) : [];

        const response = await imagekit.upload({
            file: fileBuffer,
            fileName: fileName,
            folder: folder,
            useUniqueFileName: useUniqueFileName,
            tags: safeTags,
        });

        console.log(`[ImageKit] Uploaded: ${response.url}`);

        // Delete temp file after successful upload
        await deleteTempFile(filePath);

        return {
            success: true,
            url: response.url,
            fileId: response.fileId,
            name: response.name,
            filePath: response.filePath,
            thumbnailUrl: response.thumbnailUrl,
            width: response.width,
            height: response.height,
            size: response.size,
        };
    } catch (error) {
        console.error('[ImageKit] Upload failed:', error.message);
        throw error;
    }
}

/**
 * Upload image to ImageKit directly from buffer or base64
 * @param {Buffer|string} fileData - File buffer or base64 string
 * @param {Object} options - Upload options
 * @param {string} options.folder - ImageKit folder path
 * @param {string} options.fileName - Filename to use
 * @param {boolean} options.useUniqueFileName - Use unique filename (default: true)
 * @param {Array} options.tags - Tags for the image
 * @param {Object} options.customMetadata - Custom metadata
 * @returns {Promise<Object>} ImageKit upload response
 */
export async function uploadImageToImageKit(fileData, options = {}) {
    const imagekit = getImageKit();

    const {
        folder = '/uploads',
        fileName = `image_${Date.now()}.webp`,
        useUniqueFileName = true,
        tags = [],
    } = options;

    try {
        let file;
        if (typeof fileData === 'string') {
            // Handle base64 data - ImageKit accepts base64 directly
            file = fileData.startsWith('data:')
                ? fileData
                : `data:image/webp;base64,${fileData}`;
        } else {
            // Buffer - convert to base64
            file = `data:image/webp;base64,${fileData.toString('base64')}`;
        }

        // Filter out any undefined/null tags
        const safeTags = Array.isArray(tags) ? tags.filter(Boolean) : [];

        const response = await imagekit.upload({
            file: file,
            fileName: fileName,
            folder: folder,
            useUniqueFileName: useUniqueFileName,
            tags: safeTags,
        });

        console.log(`[ImageKit] Uploaded: ${response.url}`);

        return {
            success: true,
            url: response.url,
            fileId: response.fileId,
            name: response.name,
            filePath: response.filePath,
            thumbnailUrl: response.thumbnailUrl,
            width: response.width,
            height: response.height,
            size: response.size,
        };
    } catch (error) {
        console.error('[ImageKit] Upload failed:', error.message);
        throw error;
    }
}

/**
 * Upload image with temp file workflow (recommended for large files)
 * 1. Save to temp folder
 * 2. Upload to ImageKit
 * 3. Delete temp file
 * @param {Buffer|string} fileData - File buffer or base64 string
 * @param {Object} options - Upload options
 * @returns {Promise<Object>} ImageKit upload response
 */
export async function uploadWithTempStorage(fileData, options = {}) {
    const { fileName = `image_${Date.now()}.webp`, ...uploadOptions } = options;

    // Save to temp file first
    const tempPath = await saveTempFile(fileData, fileName);

    try {
        // Upload to ImageKit (this also deletes the temp file on success)
        const result = await uploadToImageKit(tempPath, {
            fileName,
            ...uploadOptions,
        });

        return result;
    } catch (error) {
        // Clean up temp file on error
        await deleteTempFile(tempPath);
        throw error;
    }
}

/**
 * Delete an image from ImageKit by fileId
 * @param {string} fileId - ImageKit file ID
 * @returns {Promise<boolean>} Success status
 */
export async function deleteFromImageKit(fileId) {
    const imagekit = getImageKit();

    try {
        await imagekit.deleteFile(fileId);
        console.log(`[ImageKit] Deleted file: ${fileId}`);
        return true;
    } catch (error) {
        console.error('[ImageKit] Delete failed:', error.message);
        return false;
    }
}

/**
 * Delete multiple images from ImageKit
 * @param {string[]} fileIds - Array of ImageKit file IDs
 * @returns {Promise<Object>} Results of deletion
 */
export async function bulkDeleteFromImageKit(fileIds) {
    const imagekit = getImageKit();

    try {
        const result = await imagekit.bulkDeleteFiles(fileIds);
        console.log(`[ImageKit] Bulk deleted ${result.successfullyDeletedFileIds?.length || 0} files`);
        return result;
    } catch (error) {
        console.error('[ImageKit] Bulk delete failed:', error.message);
        throw error;
    }
}

/**
 * Get optimized image URL with transformations
 * @param {string} imagePath - ImageKit file path or URL
 * @param {Object} transformations - Transformation options
 * @returns {string} Transformed image URL
 */
export function getOptimizedUrl(imagePath, transformations = {}) {
    const imagekit = getImageKit();

    const {
        width,
        height,
        quality = 80,
        format = 'auto',
        blur,
        grayscale,
        crop,
        focus,
    } = transformations;

    const transformation = [];

    if (width) transformation.push({ width: String(width) });
    if (height) transformation.push({ height: String(height) });
    if (quality) transformation.push({ quality: String(quality) });
    if (format) transformation.push({ format });
    if (blur) transformation.push({ blur: String(blur) });
    if (grayscale) transformation.push({ effectGray: 'true' });
    if (crop) transformation.push({ crop });
    if (focus) transformation.push({ focus });

    return imagekit.url({
        path: imagePath,
        transformation: transformation,
    });
}

/**
 * Get thumbnail URL for an image
 * @param {string} imagePath - ImageKit file path or URL
 * @param {number} size - Thumbnail size (default: 150)
 * @returns {string} Thumbnail URL
 */
export function getThumbnailUrl(imagePath, size = 150) {
    return getOptimizedUrl(imagePath, {
        width: size,
        height: size,
        crop: 'at_max',
        quality: 70,
    });
}

/**
 * Get profile picture URL with standard transformations
 * @param {string} imagePath - ImageKit file path or URL
 * @param {string} size - Size preset: 'small' (64), 'medium' (128), 'large' (256)
 * @returns {string} Optimized profile picture URL
 */
export function getProfilePictureUrl(imagePath, size = 'medium') {
    const sizes = {
        small: 64,
        medium: 128,
        large: 256,
    };

    const dimension = sizes[size] || sizes.medium;

    return getOptimizedUrl(imagePath, {
        width: dimension,
        height: dimension,
        crop: 'at_max',
        quality: 80,
        format: 'auto',
    });
}

/**
 * Generate authentication parameters for client-side uploads
 * @returns {Object} Authentication parameters (token, expire, signature)
 */
export function getAuthenticationParameters() {
    const imagekit = getImageKit();
    return imagekit.getAuthenticationParameters();
}

export default {
    uploadToImageKit,
    uploadImageToImageKit,
    uploadWithTempStorage,
    saveTempFile,
    deleteTempFile,
    cleanupTempFiles,
    deleteFromImageKit,
    bulkDeleteFromImageKit,
    getOptimizedUrl,
    getThumbnailUrl,
    getProfilePictureUrl,
    getAuthenticationParameters,
};
