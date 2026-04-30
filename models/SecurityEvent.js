/**
 * SecurityEvent Model (superadmin DB)
 *
 * One row per security-relevant event across the platform: failed logins,
 * rate-limit hits, blocked IPs, suspicious input patterns, audit actions,
 * desktop/api token usage anomalies, etc.
 *
 * Designed to be cheap to write (insert-only, indexed for time-range queries
 * and superadmin filtering) and easy to read in /superadmin/security UI.
 */

import mongoose from 'mongoose';
import { connectSuperadminDB } from '@/lib/superadminDb';

export const SECURITY_EVENT_TYPES = [
    'auth.login.failed',
    'auth.login.success',
    'auth.login.locked',
    'auth.login.unlocked',
    'auth.password.reset_requested',
    'auth.password.reset_completed',
    'auth.session.revoked',
    'auth.token.invalid',
    'auth.token.expired',
    'rate_limit.hit',
    'ip.blocked',
    'ip.unblocked',
    'input.suspicious',           // sqli/xss/path-traversal pattern match
    'audit.superadmin.action',
    'audit.admin.action',
    'desktop.token.suspicious',
    'webhook.invalid_signature',
    'csrf.violation',
    'permission.denied',
];

export const SECURITY_SEVERITY = ['info', 'low', 'medium', 'high', 'critical'];

const SecurityEventSchema = new mongoose.Schema({
    type: { type: String, enum: SECURITY_EVENT_TYPES, required: true, index: true },
    severity: { type: String, enum: SECURITY_SEVERITY, default: 'info', index: true },
    message: { type: String, default: '' },

    // Source identifiers (any may be missing depending on context)
    ip: { type: String, index: true },
    userAgent: { type: String },
    method: { type: String },
    path: { type: String, index: true },

    // Identity (when known)
    userId: { type: String, index: true },        // tenant user id
    email: { type: String, index: true, lowercase: true, trim: true },
    databaseName: { type: String, index: true },  // tenant db
    role: { type: String },
    superadminId: { type: String, index: true },

    // Free-form structured payload (rate-limit window, regex hits, audit diff,
    // request body fingerprint, etc.). Strict false so callers can attach any
    // shape without schema migrations.
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    createdAt: { type: Date, default: Date.now, index: true },
}, { strict: false });

SecurityEventSchema.index({ type: 1, createdAt: -1 });
SecurityEventSchema.index({ severity: 1, createdAt: -1 });
SecurityEventSchema.index({ ip: 1, createdAt: -1 });
SecurityEventSchema.index({ databaseName: 1, createdAt: -1 });
// Optional 90-day TTL via env (operators can opt out by leaving unset).
if (process.env.SECURITY_EVENT_TTL_DAYS) {
    const days = Number(process.env.SECURITY_EVENT_TTL_DAYS);
    if (Number.isFinite(days) && days > 0) {
        SecurityEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: days * 24 * 60 * 60 });
    }
}

let SecurityEventModel = null;
let lastConnection = null;

export async function getSecurityEventModel() {
    const connection = await connectSuperadminDB();
    if (SecurityEventModel && lastConnection === connection && connection.readyState === 1) {
        return SecurityEventModel;
    }
    SecurityEventModel = connection.models.SecurityEvent || connection.model('SecurityEvent', SecurityEventSchema);
    lastConnection = connection;
    return SecurityEventModel;
}

export default getSecurityEventModel;
