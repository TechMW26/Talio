/**
 * Password Encryption Utility
 * 
 * Provides AES-256-GCM symmetric encryption for onboarding passwords.
 * 
 * SECURITY ARCHITECTURE:
 * - Uses AES-256-GCM (authenticated encryption) - provides both confidentiality and integrity
 * - Encryption key is stored in environment variable ONBOARDING_PASSWORD_KEY (never in DB)
 * - Each encryption uses a unique random IV (Initialization Vector)
 * - GCM produces an auth tag that prevents tampering
 * - Stored format: "iv:authTag:ciphertext" (all hex-encoded)
 * 
 * KEY MANAGEMENT:
 * - Generate key once: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * - Store as ONBOARDING_PASSWORD_KEY in .env
 * - Rotate by re-encrypting all stored values with the new key
 * 
 * WHY AES-256-GCM over other options:
 * - GCM mode provides authenticated encryption (detects tampering)
 * - 256-bit key strength is industry standard for sensitive data
 * - Native Node.js crypto - no additional dependencies
 * - Better than AES-CBC because GCM includes built-in integrity verification
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;        // 128-bit IV for GCM
const AUTH_TAG_LENGTH = 16;  // 128-bit authentication tag
const KEY_LENGTH = 32;       // 256-bit key

/**
 * Get the encryption key from environment variables.
 * Falls back to deriving a key from JWT_SECRET if ONBOARDING_PASSWORD_KEY is not set.
 * 
 * @returns {Buffer} 32-byte encryption key
 * @throws {Error} If no key source is available
 */
function getEncryptionKey() {
    const envKey = process.env.ONBOARDING_PASSWORD_KEY;

    if (envKey) {
        // If the env key is a hex string (64 chars = 32 bytes), use directly
        if (envKey.length === 64 && /^[0-9a-fA-F]+$/.test(envKey)) {
            return Buffer.from(envKey, 'hex');
        }
        // Otherwise, derive a 32-byte key from whatever string is provided
        return crypto.createHash('sha256').update(envKey).digest();
    }

    // Fallback: derive from JWT_SECRET (so the system works without adding a new env var)
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret) {
        // Use HKDF-like derivation to create a separate key from JWT_SECRET
        // This ensures the encryption key is different from the JWT signing key
        return crypto.createHash('sha256')
            .update(`onboarding-password-encryption:${jwtSecret}`)
            .digest();
    }

    throw new Error(
        'ONBOARDING_PASSWORD_KEY or JWT_SECRET environment variable is required for password encryption. ' +
        'Generate a key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
}

/**
 * Encrypt a plaintext password for secure storage.
 * 
 * @param {string} plaintext - The password to encrypt
 * @returns {string} Encrypted string in format "iv:authTag:ciphertext" (hex-encoded)
 * @throws {Error} If encryption fails or key is unavailable
 */
export function encryptPassword(plaintext) {
    if (!plaintext || typeof plaintext !== 'string') {
        return null;
    }

    try {
        const key = getEncryptionKey();
        const iv = crypto.randomBytes(IV_LENGTH);

        const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
            authTagLength: AUTH_TAG_LENGTH,
        });

        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag();

        // Format: iv:authTag:ciphertext (all hex)
        return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
        console.error('[PasswordEncryption] Encryption failed:', error.message);
        throw new Error('Failed to encrypt password');
    }
}

/**
 * Decrypt a stored encrypted password.
 * 
 * @param {string} encryptedValue - Encrypted string in format "iv:authTag:ciphertext"
 * @returns {string|null} Decrypted plaintext password, or null if decryption fails
 */
export function decryptPassword(encryptedValue) {
    if (!encryptedValue || typeof encryptedValue !== 'string') {
        return null;
    }

    // Check if the value looks like our encrypted format (iv:authTag:ciphertext)
    const parts = encryptedValue.split(':');
    if (parts.length !== 3) {
        // This might be a legacy plaintext password that wasn't migrated
        // Return null - don't return raw values
        console.warn('[PasswordEncryption] Invalid encrypted format detected (possible legacy plaintext)');
        return null;
    }

    try {
        const key = getEncryptionKey();
        const [ivHex, authTagHex, ciphertext] = parts;

        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
            authTagLength: AUTH_TAG_LENGTH,
        });
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        // GCM will throw if the auth tag doesn't match (tampering detected)
        // or if the key is wrong
        console.error('[PasswordEncryption] Decryption failed:', error.message);
        return null;
    }
}

/**
 * Mask a password for display in API list responses.
 * Shows first 3 characters + asterisks for security.
 * 
 * @param {string} password - The plaintext password to mask
 * @returns {string} Masked password (e.g., "Mar***")
 */
export function maskPassword(password) {
    if (!password || typeof password !== 'string') {
        return null;
    }

    if (password.length <= 3) {
        return '***';
    }

    return password.substring(0, 3) + '*'.repeat(Math.min(password.length - 3, 5));
}

/**
 * Encrypt a plaintext password for migration purposes.
 * Same as encryptPassword but with explicit error handling for batch operations.
 * 
 * @param {string} plaintext - The password to encrypt
 * @returns {{ success: boolean, encrypted?: string, error?: string }}
 */
export function encryptPasswordSafe(plaintext) {
    try {
        const encrypted = encryptPassword(plaintext);
        return { success: true, encrypted };
    } catch (error) {
        return { success: false, error: error.message };
    }
}
