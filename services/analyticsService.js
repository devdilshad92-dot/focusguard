/**
 * analyticsService.js — productivity & wellness statistics.
 *
 * Stores a compact per-day record inside the GSettings `analytics-data` JSON
 * blob. Writes are debounced so a busy focus block doesn't hammer dconf, and the
 * history is capped to a rolling window so the blob can never grow without
 * bound.
 *
 * Daily record shape:
 *   {
 *     focus: <seconds focused>,
 *     breaksTaken: <count>,
 *     breaksSkipped: <count>,
 *     snoozes: <count>,
 *     water: <glasses>,
 *     longestFocus: <seconds, best single block>,
 *   }
 */
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import { localDayKey, dayDiff, round } from '../utils/helpers.js';
import { Logger } from '../utils/logger.js';

const HISTORY_DAYS = 120;            // keep ~4 months of daily records
const FLUSH_DEBOUNCE_MS = 5000;      // coalesce writes to dconf

const EMPTY_DAY = () => ({
    focus: 0,
    breaksTaken: 0,
    breaksSkipped: 0,
    snoozes: 0,
    water: 0,
    longestFocus: 0,
});

export const AnalyticsService = GObject.registerClass({
    GTypeName: 'FocusGuardAnalyticsService',
    Signals: {
        'updated': {},
    },
}, class AnalyticsService extends GObject.Object {
    _init(settings) {
        super._init();
        this._settings = settings;
        this._data = this._load();
        this._flushId = 0;
        this._currentBlockFocus = 0; // running length of the active focus block
    }

    _load() {
        const raw = this._settings.analyticsData;
        const days = raw && typeof raw === 'object' ? raw.days ?? {} : {};
        return { days };
    }

    _todayKey() {
        return localDayKey();
    }

    _today() {
        const key = this._todayKey();
        if (!this._data.days[key])
            this._data.days[key] = EMPTY_DAY();
        return this._data.days[key];
    }

    // ---- Recording ----------------------------------------------------------

    /** Add focused seconds (called once per elapsed work second, batched). */
    addFocusSeconds(seconds) {
        const today = this._today();
        today.focus += seconds;
        this._currentBlockFocus += seconds;
        if (this._currentBlockFocus > today.longestFocus)
            today.longestFocus = this._currentBlockFocus;
        this._scheduleFlush();
    }

    /** A focus block ended (break started or session stopped). */
    endFocusBlock() {
        this._currentBlockFocus = 0;
    }

    recordBreakTaken() {
        this._today().breaksTaken += 1;
        this.endFocusBlock();
        this._scheduleFlush(true);
    }

    recordBreakSkipped() {
        this._today().breaksSkipped += 1;
        this._scheduleFlush(true);
    }

    recordSnooze() {
        this._today().snoozes += 1;
        this._scheduleFlush(true);
    }

    addWater(delta = 1) {
        const today = this._today();
        today.water = Math.max(0, today.water + delta);
        this._scheduleFlush(true);
    }

    // ---- Queries ------------------------------------------------------------

    getToday() {
        return { ...EMPTY_DAY(), ...this._today() };
    }

    getDay(key) {
        return { ...EMPTY_DAY(), ...(this._data.days[key] ?? {}) };
    }

    /** Ordered array of {date, ...record} for the last `n` days incl. today. */
    getRange(n = 7) {
        const out = [];
        const now = new Date();
        for (let i = n - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(now.getDate() - i);
            const key = localDayKey(d);
            out.push({ date: key, ...this.getDay(key) });
        }
        return out;
    }

    /** Break compliance over the last `n` days, as a 0–1 ratio. */
    getComplianceRate(n = 7) {
        const range = this.getRange(n);
        let taken = 0;
        let total = 0;
        for (const day of range) {
            taken += day.breaksTaken;
            total += day.breaksTaken + day.breaksSkipped;
        }
        return total === 0 ? 1 : round(taken / total, 3);
    }

    /** Longest consecutive run (in days) meeting the daily focus goal. */
    getLongestStreak(goalSeconds) {
        const keys = Object.keys(this._data.days).sort();
        let best = 0;
        let run = 0;
        let prevKey = null;
        for (const key of keys) {
            const met = this._data.days[key].focus >= goalSeconds;
            if (!met) {
                run = 0;
                prevKey = key;
                continue;
            }
            run = prevKey && dayDiff(prevKey, key) === 1 ? run + 1 : 1;
            best = Math.max(best, run);
            prevKey = key;
        }
        return best;
    }

    /** Current streak (consecutive days up to today meeting the goal). */
    getCurrentStreak(goalSeconds) {
        let streak = 0;
        const now = new Date();
        for (let i = 0; ; i++) {
            const d = new Date(now);
            d.setDate(now.getDate() - i);
            const rec = this._data.days[localDayKey(d)];
            if (rec && rec.focus >= goalSeconds)
                streak += 1;
            else
                break;
        }
        return streak;
    }

    /**
     * Adaptive recommendation: shorten focus blocks when recent compliance is
     * poor (people who skip breaks need gentler, more frequent nudges) and
     * extend them when compliance is excellent.
     * @returns {number|null} suggested work seconds, or null to use the default
     */
    suggestedWorkDuration(baseSeconds) {
        const compliance = this.getComplianceRate(7);
        let factor = 1;
        if (compliance < 0.5)
            factor = 0.8;
        else if (compliance > 0.9)
            factor = 1.15;
        if (factor === 1)
            return null;
        // Clamp to sensible bounds so the adaptation never feels jarring.
        const suggested = Math.round(baseSeconds * factor / 60) * 60;
        return Math.max(300, Math.min(suggested, 5400));
    }

    // ---- Persistence --------------------------------------------------------

    _prune() {
        const keys = Object.keys(this._data.days);
        if (keys.length <= HISTORY_DAYS)
            return;
        keys.sort();
        for (const key of keys.slice(0, keys.length - HISTORY_DAYS))
            delete this._data.days[key];
    }

    _scheduleFlush(immediateSignal = false) {
        if (immediateSignal)
            this.emit('updated');
        if (this._flushId)
            return;
        this._flushId = GLib.timeout_add(
            GLib.PRIORITY_LOW, FLUSH_DEBOUNCE_MS, () => {
                this._flushId = 0;
                this.flush();
                return GLib.SOURCE_REMOVE;
            });
    }

    /** Persist immediately. Called on debounce and on disable(). */
    flush() {
        try {
            this._prune();
            this._settings.analyticsData = { days: this._data.days };
            this.emit('updated');
        } catch (e) {
            Logger.trace(e, 'analytics flush');
        }
    }

    /** Wipe all stored statistics. */
    reset() {
        this._data = { days: {} };
        this._currentBlockFocus = 0;
        this.flush();
    }

    destroy() {
        if (this._flushId) {
            GLib.source_remove(this._flushId);
            this._flushId = 0;
        }
        this.flush();
        this._settings = null;
    }
});
