import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey() {
    const envKey = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY;

    if (envKey) {
        if (envKey.length === 64 && /^[0-9a-fA-F]+$/.test(envKey)) {
            return Buffer.from(envKey, 'hex');
        }

        return crypto.createHash('sha256').update(envKey).digest();
    }

    if (process.env.JWT_SECRET) {
        return crypto
            .createHash('sha256')
            .update(`integration-token-encryption:${process.env.JWT_SECRET}`)
            .digest();
    }

    throw new Error(
        'INTEGRATION_TOKEN_ENCRYPTION_KEY or JWT_SECRET environment variable is required for integration token encryption.'
    );
}

export function isEncryptedSecret(value) {
    if (!value || typeof value !== 'string') {
        return false;
    }

    const parts = value.split(':');
    if (parts.length !== 3) {
        return false;
    }

    return parts.every((part) => /^[0-9a-fA-F]+$/.test(part));
}

export function encryptSecret(plaintext) {
    if (!plaintext || typeof plaintext !== 'string') {
        return null;
    }

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
}

export function decryptSecret(encryptedValue) {
    if (!isEncryptedSecret(encryptedValue)) {
        return null;
    }

    try {
        const [ivHex, authTagHex, ciphertext] = encryptedValue.split(':');
        const key = getEncryptionKey();
        const decipher = crypto.createDecipheriv(
            ALGORITHM,
            key,
            Buffer.from(ivHex, 'hex'),
            { authTagLength: AUTH_TAG_LENGTH }
        );

        decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

        let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        console.error('[SecretEncryption] Decryption failed:', error.message);
        return null;
    }
}