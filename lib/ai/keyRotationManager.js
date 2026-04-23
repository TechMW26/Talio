// Round-robin key selector with per-key health tracking and exponential cooldown.
// Designed for in-process use; safe under Node's single-threaded event loop.

const DEFAULT_BASE_COOLDOWN_MS = 60_000; // 1 minute
const DEFAULT_MAX_COOLDOWN_MS = 10 * 60_000; // 10 minutes

export class KeyRotationManager {
    /**
     * @param {string} providerName
     * @param {string[]} keys - ordered list of API keys (already validated/non-empty)
     */
    constructor(providerName, keys = [], options = {}) {
        this.providerName = providerName;
        this.keys = Array.isArray(keys) ? keys.filter(Boolean) : [];
        this.baseCooldownMs = options.baseCooldownMs || DEFAULT_BASE_COOLDOWN_MS;
        this.maxCooldownMs = options.maxCooldownMs || DEFAULT_MAX_COOLDOWN_MS;

        this.cursor = 0;
        // index -> { failures, cooldownUntil, lastErrorClass }
        this.health = this.keys.map(() => ({
            failures: 0,
            cooldownUntil: 0,
            lastErrorClass: null,
        }));
    }

    get size() {
        return this.keys.length;
    }

    isAvailable() {
        const now = Date.now();
        return this.keys.some((_, i) => this.health[i].cooldownUntil <= now);
    }

    /**
     * Yields healthy keys in round-robin order, starting from the rotation
     * cursor. Returns at most `keys.length` entries per call.
     */
    *iterateHealthy() {
        const now = Date.now();
        const total = this.keys.length;
        if (total === 0) return;

        for (let offset = 0; offset < total; offset += 1) {
            const index = (this.cursor + offset) % total;
            if (this.health[index].cooldownUntil <= now) {
                yield { index, key: this.keys[index] };
            }
        }
    }

    advanceCursor() {
        if (this.keys.length > 0) {
            this.cursor = (this.cursor + 1) % this.keys.length;
        }
    }

    markSuccess(index) {
        if (index < 0 || index >= this.health.length) return;
        this.health[index].failures = 0;
        this.health[index].cooldownUntil = 0;
        this.health[index].lastErrorClass = null;
        // Move cursor past the successful key so traffic spreads over keys.
        this.cursor = (index + 1) % this.keys.length;
    }

    markFailure(index, errorClass = 'unknown') {
        if (index < 0 || index >= this.health.length) return;
        const h = this.health[index];
        h.failures += 1;
        h.lastErrorClass = errorClass;
        const exp = Math.min(this.maxCooldownMs, this.baseCooldownMs * (2 ** (h.failures - 1)));
        h.cooldownUntil = Date.now() + exp;
    }

    getStatus() {
        return {
            provider: this.providerName,
            total: this.keys.length,
            healthy: this.keys.filter((_, i) => this.health[i].cooldownUntil <= Date.now()).length,
        };
    }
}
