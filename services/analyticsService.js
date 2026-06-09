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
import { localDayKey, dayDiff, round, clamp, formatDurationLong } from '../utils/helpers.js';
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
    eyeRemindersShown: 0,
    eyeRemindersCompleted: 0,
    eyeRemindersSkipped: 0,
    hydrationRemindersCompleted: 0,
    lastWaterLoggedTimestamp: 0,
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
        if (delta > 0) {
            today.lastWaterLoggedTimestamp = Date.now();
        }
        this._scheduleFlush(true);
    }

    /** Reset today's water count to zero. */
    resetWaterToday() {
        const today = this._today();
        today.water = 0;
        today.lastWaterLoggedTimestamp = 0;
        this._scheduleFlush(true);
    }

    recordEyeReminderShown() {
        const today = this._today();
        today.eyeRemindersShown = (today.eyeRemindersShown || 0) + 1;
        this._scheduleFlush(true);
    }

    recordEyeReminderCompleted() {
        const today = this._today();
        today.eyeRemindersCompleted = (today.eyeRemindersCompleted || 0) + 1;
        this._scheduleFlush(true);
    }

    recordEyeReminderSkipped() {
        const today = this._today();
        today.eyeRemindersSkipped = (today.eyeRemindersSkipped || 0) + 1;
        this._scheduleFlush(true);
    }

    recordHydrationReminderCompleted() {
        const today = this._today();
        today.hydrationRemindersCompleted = (today.hydrationRemindersCompleted || 0) + 1;
        this._scheduleFlush(true);
    }

    // ---- Queries ------------------------------------------------------------

    getToday() {
        return { ...EMPTY_DAY(), ...this._today() };
    }

    calculateFocusScoreForRecord(record) {
        const dailyFocusGoal = this._settings.dailyFocusGoal || 14400;
        const dailyWaterGoal = this._settings.dailyWaterGoal || 8;
        
        // 1. Focus Time Consistency (40%)
        const focusRatio = record.focus / dailyFocusGoal;
        const focusComponent = Math.min(1, focusRatio) * 40;
        
        // 2. Break Quality (25%)
        const totalBreaks = record.breaksTaken + record.breaksSkipped;
        const breakRatio = totalBreaks === 0 ? 1.0 : record.breaksTaken / totalBreaks;
        const snoozeDeduction = (record.snoozes || 0) * 2;
        const breakComponent = clamp(breakRatio * 25 - snoozeDeduction, 0, 25);
        
        // 3. Hydration (15%)
        const waterRatio = record.water / dailyWaterGoal;
        const hydrationComponent = Math.min(1, waterRatio) * 15;
        
        // 4. Eye Care (20%)
        const totalEye = record.eyeRemindersShown || 0;
        const eyeRatio = totalEye === 0 ? 1.0 : (record.eyeRemindersCompleted || 0) / totalEye;
        const eyeComponent = eyeRatio * 20;
        
        return Math.round(focusComponent + breakComponent + hydrationComponent + eyeComponent);
    }
    
    calculateRecoveryScoreForRecord(record) {
        const dailyWaterGoal = this._settings.dailyWaterGoal || 8;
        let score = 100;
        
        // 1. Continuous Work Penalty (up to -40)
        const longest = record.longestFocus || 0;
        if (longest > 90 * 60) {
            score -= 40;
        } else if (longest > 60 * 60) {
            score -= 25;
        } else if (longest > 45 * 60) {
            score -= 10;
        }
        
        // 2. Break Compliance Penalty (up to -30)
        const totalBreaks = record.breaksTaken + record.breaksSkipped;
        const breakCompliance = totalBreaks === 0 ? 1.0 : record.breaksTaken / totalBreaks;
        score -= (1 - breakCompliance) * 30;
        
        // 3. Eye Compliance Penalty (up to -15)
        const totalEye = record.eyeRemindersShown || 0;
        const eyeCompliance = totalEye === 0 ? 1.0 : (record.eyeRemindersCompleted || 0) / totalEye;
        score -= (1 - eyeCompliance) * 15;
        
        // 4. Hydration Penalty (up to -15)
        const waterRatio = record.water / dailyWaterGoal;
        score -= (1 - Math.min(1, waterRatio)) * 15;
        
        return Math.round(clamp(score, 0, 100));
    }
    
    getTodayBurnoutAndRecovery() {
        const today = this.getToday();
        const score = this.calculateRecoveryScoreForRecord(today);
        let risk = 'Low';
        if (score < 45) {
            risk = 'High';
        } else if (score < 75) {
            risk = 'Moderate';
        }
        return { score, risk };
    }
    
    getTodayFocusScore() {
        const today = this.getToday();
        return this.calculateFocusScoreForRecord(today);
    }

    getWeeklyReportStats() {
        const range = this.getRange(7);
        let totalFocusSec = 0;
        let totalWater = 0;
        let totalBreaksTaken = 0;
        let totalBreaksSkipped = 0;
        let totalEyeShown = 0;
        let totalEyeCompleted = 0;
        let maxLongestFocus = 0;
        let mostProductiveDayKey = '—';
        let maxDayFocusSec = 0;
        
        let focusScores = [];
        let recoveryScores = [];
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        
        for (const day of range) {
            totalFocusSec += day.focus;
            totalWater += day.water;
            totalBreaksTaken += day.breaksTaken;
            totalBreaksSkipped += day.breaksSkipped;
            totalEyeShown += day.eyeRemindersShown || 0;
            totalEyeCompleted += day.eyeRemindersCompleted || 0;
            if (day.longestFocus > maxLongestFocus) {
                maxLongestFocus = day.longestFocus;
            }
            if (day.focus > maxDayFocusSec) {
                maxDayFocusSec = day.focus;
                try {
                    const d = new Date(`${day.date}T00:00:00`);
                    mostProductiveDayKey = daysOfWeek[d.getDay()];
                } catch {
                    mostProductiveDayKey = '—';
                }
            }
            
            focusScores.push(this.calculateFocusScoreForRecord(day));
            recoveryScores.push(this.calculateRecoveryScoreForRecord(day));
        }
        
        const avgFocus = focusScores.reduce((a, b) => a + b, 0) / Math.max(1, focusScores.length);
        const avgRecovery = recoveryScores.reduce((a, b) => a + b, 0) / Math.max(1, recoveryScores.length);
        
        const breakTotal = totalBreaksTaken + totalBreaksSkipped;
        const breakComplianceVal = breakTotal === 0 ? 100 : Math.round((totalBreaksTaken / breakTotal) * 100);
        const eyeComplianceVal = totalEyeShown === 0 ? 100 : Math.round((totalEyeCompleted / totalEyeShown) * 100);
        
        return {
            totalFocus: formatDurationLong(totalFocusSec),
            breakCompliance: `${breakComplianceVal}%`,
            waterIntake: `${totalWater} Glasses`,
            eyeCareCompliance: `${eyeComplianceVal}%`,
            avgFocusScore: `${Math.round(avgFocus)}/100`,
            avgRecoveryScore: `${Math.round(avgRecovery)}/100`,
            mostProductiveDay: mostProductiveDayKey !== '—' ? `${mostProductiveDayKey} (${formatDurationLong(maxDayFocusSec)})` : '—',
            longestFocusSession: formatDurationLong(maxLongestFocus),
        };
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
        // Clamp relative to the user's own setting — never less than 5 min,
        // never more than 20% above their configured duration.
        const suggested = Math.round(baseSeconds * factor / 60) * 60;
        return Math.max(300, Math.min(suggested, Math.round(baseSeconds * 1.2)));
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
