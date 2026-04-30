/**
 * Lightweight input validator: detects common SQLi, NoSQLi, XSS, command-
 * injection, path-traversal, and prototype-pollution attempts in request
 * payloads.
 *
 * NOT a replacement for proper parameterized queries / output escaping. This
 * is a defense-in-depth signal used to (a) record SecurityEvents and
 * (b) optionally escalate to an IP block on repeated hits.
 */

const PATTERNS = [
    { name: 'sqli', severity: 'high', regex: /(\b(union\s+select|or\s+1\s*=\s*1|drop\s+table|;\s*--|xp_cmdshell|information_schema)\b)/i },
    { name: 'xss', severity: 'high', regex: /(<script\b[^>]*>|javascript:\s*[a-z]|onerror\s*=|onload\s*=|<iframe\b)/i },
    { name: 'command_injection', severity: 'high', regex: /(\$\(.*\)|`[^`]+`|\|\s*(?:nc|bash|sh|curl|wget)\b)/i },
    { name: 'path_traversal', severity: 'medium', regex: /(\.\.[\\/]){2,}|%2e%2e[\\/]/i },
    { name: 'nosqli', severity: 'high', regex: /\$where\s*:|\$gt\s*:\s*['"]?\s*['"]?|\$ne\s*:\s*null/i },
    { name: 'proto_pollution', severity: 'critical', regex: /(__proto__|constructor\s*\.\s*prototype)/i },
];

const SCAN_DEPTH_LIMIT = 6;
const SCAN_VALUE_LIMIT = 4000;

function scanValue(value, hits, depth = 0) {
    if (depth > SCAN_DEPTH_LIMIT) return;
    if (value == null) return;
    if (typeof value === 'string') {
        const target = value.length > SCAN_VALUE_LIMIT ? value.slice(0, SCAN_VALUE_LIMIT) : value;
        for (const p of PATTERNS) {
            if (p.regex.test(target)) {
                hits.push({ name: p.name, severity: p.severity, sample: target.slice(0, 200) });
            }
        }
        return;
    }
    if (typeof value !== 'object') return;
    if (Array.isArray(value)) {
        for (const item of value) scanValue(item, hits, depth + 1);
        return;
    }
    for (const [k, v] of Object.entries(value)) {
        // Key itself can be malicious (proto pollution, $-operators).
        for (const p of PATTERNS) {
            if (p.regex.test(k)) {
                hits.push({ name: p.name, severity: p.severity, sample: `key:${k.slice(0, 100)}` });
            }
        }
        scanValue(v, hits, depth + 1);
    }
}

/**
 * Scan an arbitrary JSON-like payload for suspicious patterns.
 * Returns { suspicious: bool, hits: [{name, severity, sample}], topSeverity }
 */
export function scanPayload(payload) {
    const hits = [];
    scanValue(payload, hits, 0);
    if (hits.length === 0) {
        return { suspicious: false, hits: [], topSeverity: 'info' };
    }
    const order = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
    let topSeverity = 'info';
    for (const h of hits) {
        if (order[h.severity] > order[topSeverity]) topSeverity = h.severity;
    }
    return { suspicious: true, hits, topSeverity };
}

/**
 * Scan a URL search params string for suspicious patterns.
 */
export function scanSearchParams(searchParams) {
    if (!searchParams) return { suspicious: false, hits: [], topSeverity: 'info' };
    const obj = {};
    if (typeof searchParams.entries === 'function') {
        for (const [k, v] of searchParams.entries()) obj[k] = v;
    }
    return scanPayload(obj);
}
