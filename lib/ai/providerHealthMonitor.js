// Tracks provider-level circuit-breaker state. When a provider is fully
// exhausted (all keys cooling down or repeated total failures), we briefly stop
// trying it before falling back so we don't waste request latency.

const DEFAULT_CIRCUIT_COOLDOWN_MS = 30_000;

export class ProviderHealthMonitor {
    constructor(options = {}) {
        this.cooldownMs = options.cooldownMs || DEFAULT_CIRCUIT_COOLDOWN_MS;
        this.state = new Map(); // providerName -> { openUntil, consecutiveFailures, lastSuccessAt }
    }

    _entry(name) {
        if (!this.state.has(name)) {
            this.state.set(name, { openUntil: 0, consecutiveFailures: 0, lastSuccessAt: 0 });
        }
        return this.state.get(name);
    }

    isAvailable(name) {
        const entry = this._entry(name);
        return entry.openUntil <= Date.now();
    }

    markSuccess(name) {
        const entry = this._entry(name);
        entry.consecutiveFailures = 0;
        entry.openUntil = 0;
        entry.lastSuccessAt = Date.now();
    }

    markFailure(name) {
        const entry = this._entry(name);
        entry.consecutiveFailures += 1;
        // Open circuit after 3 back-to-back full-provider failures.
        if (entry.consecutiveFailures >= 3) {
            entry.openUntil = Date.now() + this.cooldownMs;
        }
    }

    snapshot() {
        const out = {};
        for (const [name, value] of this.state.entries()) {
            out[name] = {
                healthy: value.openUntil <= Date.now(),
                consecutiveFailures: value.consecutiveFailures,
                lastSuccessAt: value.lastSuccessAt,
            };
        }
        return out;
    }
}
