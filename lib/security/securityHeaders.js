/**
 * Centralized HTTP security headers.
 *
 * Used by:
 *  - next.config.js (static + dashboard responses)
 *  - middleware.js  (per-request enrichment, CSP nonce optional)
 *
 * CSP allows the third parties Talio actually uses today:
 *  - ImageKit CDN for legacy uploads
 *  - Self for Socket.IO (proxied via /api/socketio)
 *  - Google Maps tiles (geolocation/geofence UI)
 *  - OpenStreetMap embed + Nominatim (dashboard location widget)
 *  - inline styles + data: images (Tailwind, GridFS images served as data URLs in some flows)
 */

const SELF = "'self'";

const COMMON_CONNECT_SRC = [
    SELF,
    'https://ik.imagekit.io',
    'https://maps.googleapis.com',
    'https://maps.gstatic.com',
    'https://nominatim.openstreetmap.org',
    'wss:',
    'ws:',
];

const COMMON_IMG_SRC = [
    SELF,
    'data:',
    'blob:',
    'https://ik.imagekit.io',
    'https://*.googleusercontent.com',
    'https://maps.googleapis.com',
    'https://maps.gstatic.com',
];

const COMMON_SCRIPT_SRC = [
    SELF,
    "'unsafe-inline'", // Next.js inline boot scripts; remove once nonce is wired
    "'unsafe-eval'",   // some libs (recharts, framer-motion lazy compile)
    'https://maps.googleapis.com',
];

const COMMON_STYLE_SRC = [
    SELF,
    "'unsafe-inline'", // Tailwind utility classes use inline style on hydration
    'https://fonts.googleapis.com',
];

const COMMON_FONT_SRC = [SELF, 'data:', 'https://fonts.gstatic.com'];
const COMMON_FRAME_SRC = [
    SELF,
    'https://www.google.com',
    'https://maps.google.com',
    'https://www.openstreetmap.org',
];
const COMMON_MEDIA_SRC = [SELF, 'data:', 'blob:'];
const COMMON_WORKER_SRC = [SELF, 'blob:'];

function buildCsp() {
    const directives = {
        'default-src': [SELF],
        'script-src': COMMON_SCRIPT_SRC,
        'style-src': COMMON_STYLE_SRC,
        'img-src': COMMON_IMG_SRC,
        'font-src': COMMON_FONT_SRC,
        'connect-src': COMMON_CONNECT_SRC,
        'frame-src': COMMON_FRAME_SRC,
        'media-src': COMMON_MEDIA_SRC,
        'worker-src': COMMON_WORKER_SRC,
        'object-src': ["'none'"],
        'base-uri': [SELF],
        'form-action': [SELF],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': [],
    };
    return Object.entries(directives)
        .map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k))
        .join('; ');
}

const STATIC_CSP = buildCsp();

/**
 * Returns the standard set of security headers for any HTML/JSON response.
 * @param {object} [options]
 * @param {boolean} [options.includeCsp=true]   omit if a route already sets a custom CSP
 * @param {boolean} [options.reportOnly=false]  use Content-Security-Policy-Report-Only header
 */
export function getSecurityHeaders(options = {}) {
    const { includeCsp = true, reportOnly = false } = options;
    const headers = {
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=(self), payment=(), usb=(), interest-cohort=()',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'X-DNS-Prefetch-Control': 'off',
        'X-XSS-Protection': '0', // disabled per OWASP guidance; CSP is the modern defense
    };
    if (includeCsp) {
        const headerName = reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
        headers[headerName] = STATIC_CSP;
    }
    return headers;
}

/**
 * Apply security headers to a Headers / Map-like object.
 */
export function applySecurityHeaders(target, options = {}) {
    const headers = getSecurityHeaders(options);
    for (const [k, v] of Object.entries(headers)) {
        if (typeof target?.set === 'function') target.set(k, v);
        else target[k] = v;
    }
    return target;
}

/**
 * For next.config.js: returns the headers in Next's expected
 * `[{ key, value }]` array shape.
 */
export function getNextConfigSecurityHeaders(options = {}) {
    return Object.entries(getSecurityHeaders(options)).map(([key, value]) => ({ key, value }));
}
