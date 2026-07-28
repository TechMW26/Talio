/**
 * IpBlock Model (superadmin DB)
 *
 * Tracks IPs that are blocked from accessing the platform. Blocks can be:
 *  - automatic (brute-force lockout, suspicious-input lockout)
 *  - manual (added via /superadmin/security UI)
 *
 * `expiresAt` of null = permanent. A TTL index removes expired temporary
 * blocks automatically.
 */

import mongoose from 'mongoose';
import { connectSuperadminDB } from '@/lib/superadminDb';

const IpBlockSchema = new mongoose.Schema({
    ip: { type: String, required: true, unique: true, index: true },
    reason: { type: String, default: '' },
    source: { type: String, enum: ['auto', 'manual'], default: 'auto', index: true },
    eventType: { type: String, default: '' },         // last triggering event type
    hits: { type: Number, default: 1 },               // consecutive triggering events
    blockedAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, default: null },
    createdBySuperadminId: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { strict: false });

// TTL: temporary blocks auto-expire. Permanent blocks (expiresAt = null) are
// ignored by the TTL monitor.
IpBlockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

let IpBlockModel = null;
let lastConnection = null;

export async function getIpBlockModel() {
    const connection = await connectSuperadminDB();
    if (IpBlockModel && lastConnection === connection && connection.readyState === 1) {
        return IpBlockModel;
    }
    IpBlockModel = connection.models.IpBlock || connection.model('IpBlock', IpBlockSchema);
    lastConnection = connection;
    return IpBlockModel;
}

export default getIpBlockModel;
