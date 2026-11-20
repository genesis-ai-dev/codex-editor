/** Stored decisions include timestamp-only removals. Keep in sync across the three repositories. */
export interface PinDecision { timestamp?: number; version?: string; url?: string }
export type PinDecisions = Record<string, PinDecision>;
export type ActivePins = Record<string, { version: string; url: string }>;

export function validatePinDecisions(value: unknown): PinDecisions {
    if (!value || typeof value !== "object" || Array.isArray(value)) { throw new Error("Invalid extension pin map"); }
    const result: PinDecisions = {};
    for (const id of Object.keys(value).sort()) {
        const entry = (value as Record<string, unknown>)[id];
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) { throw new Error(`Invalid pin: ${id}`); }
        const pin = entry as Record<string, unknown>;
        const stamped = pin.timestamp !== undefined;
        if (stamped && (!Number.isSafeInteger(pin.timestamp) || (pin.timestamp as number) < 0)) { throw new Error(`Invalid pin timestamp: ${id}`); }
        if (stamped && pin.version === undefined && pin.url === undefined) {
            Object.defineProperty(result, id, { value: { timestamp: pin.timestamp as number }, enumerable: true, configurable: true, writable: true });
        } else {
            if (typeof pin.version !== "string" || !pin.version.trim() || typeof pin.url !== "string" || !/^https?:\/\//.test(pin.url)) { throw new Error(`Invalid pin: ${id}`); }
            Object.defineProperty(result, id, { value: { ...(stamped ? { timestamp: pin.timestamp as number } : {}), version: pin.version, url: pin.url }, enumerable: true, configurable: true, writable: true });
        }
    }
    return result;
}

/** A verified remote map breaks legacy ties, including missing legacy entries. Never call on fetch failure. */
export function mergePinDecisions(localValue: unknown, remoteValue: unknown): PinDecisions {
    const local = validatePinDecisions(localValue);
    const remote = validatePinDecisions(remoteValue);
    const result: PinDecisions = {};
    for (const id of Array.from(new Set([...Object.keys(local), ...Object.keys(remote)])).sort()) {
        const ours = Object.prototype.hasOwnProperty.call(local, id) ? local[id] : undefined;
        const theirs = Object.prototype.hasOwnProperty.call(remote, id) ? remote[id] : undefined;
        const winner = ours?.timestamp !== undefined && (theirs?.timestamp === undefined || ours.timestamp > theirs.timestamp) ? ours : theirs;
        if (winner) { Object.defineProperty(result, id, { value: winner, enumerable: true, configurable: true, writable: true }); }
    }
    return result;
}

/** Only installation data participates in profile identity and reload decisions. */
export function activePins(value: unknown): ActivePins {
    const result: ActivePins = {};
    for (const [id, pin] of Object.entries(validatePinDecisions(value))) {
        if (pin.version !== undefined && pin.url !== undefined) {
            Object.defineProperty(result, id, { value: { version: pin.version, url: pin.url }, enumerable: true, configurable: true, writable: true });
        }
    }
    return result;
}

/** Legacy dates are unknown. Zero is a stable migration baseline, never the time of sync. */
export function timestampPinDecisions(value: unknown): PinDecisions {
    return Object.fromEntries(Object.entries(validatePinDecisions(value)).map(([id, pin]) => [id, { timestamp: pin.timestamp ?? 0, ...pin }]));
}

/** Stamp only explicit edits, after re-reading the latest map inside the writer queue. */
export function editPinDecisions(currentValue: unknown, edits: Record<string, { version: string; url: string } | null>, now = Date.now()): PinDecisions {
    const result = timestampPinDecisions(currentValue);
    for (const [id, pin] of Object.entries(edits)) {
        const previous = Object.prototype.hasOwnProperty.call(result, id) ? result[id] : undefined;
        const timestamp = Math.max(now, (previous?.timestamp ?? -1) + 1);
        if (!Number.isSafeInteger(timestamp) || timestamp < 0) { throw new Error("Invalid pin edit timestamp"); }
        Object.defineProperty(result, id, { value: pin ? { timestamp, version: pin.version, url: pin.url } : { timestamp }, enumerable: true, configurable: true, writable: true });
    }
    return validatePinDecisions(result);
}
