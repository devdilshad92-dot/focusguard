/**
 * helpers.js — small pure utilities shared across the extension.
 *
 * Everything here is side-effect free and unit-testable, which keeps the
 * stateful services lean.
 */

/** Clamp `value` into the inclusive range [min, max]. */
export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * Format a duration in seconds as a compact countdown.
 *   65    -> "1:05"
 *   3725  -> "1:02:05"
 */
export function formatCountdown(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    const pad = n => String(n).padStart(2, '0');
    if (hours > 0)
        return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    return `${minutes}:${pad(seconds)}`;
}

/**
 * Human-friendly duration for summaries.
 *   3600 -> "1h", 5400 -> "1h 30m", 300 -> "5m", 45 -> "45s"
 */
export function formatDurationLong(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    if (s < 60)
        return `${s}s`;
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const parts = [];
    if (hours > 0)
        parts.push(`${hours}h`);
    if (minutes > 0)
        parts.push(`${minutes}m`);
    return parts.join(' ') || '0m';
}

/** ISO `YYYY-MM-DD` for a Date in local time (used as the analytics day key). */
export function localDayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Number of whole days between two `YYYY-MM-DD` keys (b - a). */
export function dayDiff(aKey, bKey) {
    const a = new Date(`${aKey}T00:00:00`);
    const b = new Date(`${bKey}T00:00:00`);
    return Math.round((b - a) / 86400000);
}

/** Pick a deterministic-ish but varied element so tips don't feel random-stuck. */
let _rotation = 0;
export function rotate(array) {
    if (!array.length)
        return undefined;
    const item = array[_rotation % array.length];
    _rotation += 1;
    return item;
}

/** Pick a uniformly random element. */
export function sample(array) {
    if (!array.length)
        return undefined;
    return array[Math.floor(Math.random() * array.length)];
}

/**
 * Format seconds as zero-padded HH:MM:SS for live countdown displays.
 *   0     → "00:00:00"
 *   65    → "00:01:05"
 *   8263  → "02:17:43"
 */
export function formatHMS(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = n => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/**
 * Format seconds as a short human label for menu rows.
 *   65   -> "1m 5s"
 *   3720 -> "1h 2m"
 *   45   -> "45s"
 */
export function formatMenuTime(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    if (m > 0) return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
    return `${sec}s`;
}

/** Round to a fixed number of decimals and strip trailing zeros. */
export function round(value, decimals = 1) {
    const f = 10 ** decimals;
    return Math.round(value * f) / f;
}

/** Safe JSON parse that never throws; returns `fallback` on failure. */
export function safeJsonParse(text, fallback) {
    try {
        const parsed = JSON.parse(text);
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}
