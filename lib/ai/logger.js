// Production-safe AI routing logger. Never logs raw API keys, tokens, or prompt
// payloads. Key indices and identifier hashes are used instead so operators can
// correlate failures without leaking secrets.
import crypto from 'crypto';

const PREFIX = '[AIRouter]';

function safeStringify(meta = {}) {
    try {
        return JSON.stringify(meta);
    } catch {
        return '{}';
    }
}

export function maskKey(value) {
    if (!value || typeof value !== 'string') return 'none';
    if (value.length <= 8) return '***';
    return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

export function fingerprint(value) {
    if (!value) return 'none';
    return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 8);
}

export function logEvent(level, event, meta = {}) {
    const line = `${PREFIX} ${event} ${safeStringify(meta)}`;
    const fn = console[level] || console.log;
    fn(line);
}

export const aiLogger = {
    info: (event, meta) => logEvent('log', event, meta),
    warn: (event, meta) => logEvent('warn', event, meta),
    error: (event, meta) => logEvent('error', event, meta),
};
