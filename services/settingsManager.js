/**
 * settingsManager.js — typed, observable wrapper around Gio.Settings.
 *
 * Rather than sprinkle `settings.get_int('work-duration')` across the code we
 * expose semantic getters/setters and a single `connect` helper. This keeps the
 * GSettings key strings in one place (utils/constants Keys) and gives us a tidy
 * spot to add validation, import/export and migration logic.
 */
import GLib from 'gi://GLib';
import { Keys } from '../utils/constants.js';
import { safeJsonParse } from '../utils/helpers.js';
import { Logger } from '../utils/logger.js';

export class SettingsManager {
    /** @param {import('gi://Gio').Settings} gioSettings */
    constructor(gioSettings) {
        this._settings = gioSettings;
        this._handlerIds = [];
    }

    /** The raw Gio.Settings, for code that needs to `bind()` directly (prefs). */
    get gio() {
        return this._settings;
    }

    // ---- Generic typed accessors -------------------------------------------
    getInt(key) { return this._settings.get_int(key); }
    setInt(key, value) { this._settings.set_int(key, value); }
    getBool(key) { return this._settings.get_boolean(key); }
    setBool(key, value) { this._settings.set_boolean(key, value); }
    getString(key) { return this._settings.get_string(key); }
    setString(key, value) { this._settings.set_string(key, value); }
    getEnum(key) { return this._settings.get_string(key); }
    getIntArray(key) { return this._settings.get_value(key).deepUnpack(); }

    // ---- Convenience semantic getters --------------------------------------
    get timerMode() { return this.getString(Keys.TIMER_MODE); }
    get workDuration() { return this.getInt(Keys.WORK_DURATION); }
    get breakDuration() { return this.getInt(Keys.BREAK_DURATION); }
    get longBreakDuration() { return this.getInt(Keys.LONG_BREAK_DURATION); }
    get pomodorosUntilLongBreak() { return this.getInt(Keys.POMODOROS_UNTIL_LONG_BREAK); }
    get autoStartBreaks() { return this.getBool(Keys.AUTO_START_BREAKS); }
    get autoStartWork() { return this.getBool(Keys.AUTO_START_WORK); }

    get pauseOnIdle() { return this.getBool(Keys.PAUSE_ON_IDLE); }
    get idleThreshold() { return this.getInt(Keys.IDLE_THRESHOLD); }
    get idleResetThreshold() { return this.getInt(Keys.IDLE_RESET_THRESHOLD); }

    get reminderStyle() { return this.getString(Keys.REMINDER_STYLE); }
    get enableNotifications() { return this.getBool(Keys.ENABLE_NOTIFICATIONS); }
    get enableSounds() { return this.getBool(Keys.ENABLE_SOUNDS); }
    get escalateIgnored() { return this.getBool(Keys.ESCALATE_IGNORED); }
    get escalationInterval() { return this.getInt(Keys.ESCALATION_INTERVAL); }
    get postponeOnFullscreen() { return this.getBool(Keys.POSTPONE_ON_FULLSCREEN); }
    get postponeOnInhibit() { return this.getBool(Keys.POSTPONE_ON_INHIBIT); }
    get snoozeDurations() { return this.getIntArray(Keys.SNOOZE_DURATIONS); }
    get adaptiveScheduling() { return this.getBool(Keys.ADAPTIVE_SCHEDULING); }

    get overlayFadeMs() { return this.getInt(Keys.OVERLAY_FADE_MS); }
    get showStretchTips() { return this.getBool(Keys.SHOW_STRETCH_TIPS); }
    get showEyeCare() { return this.getBool(Keys.SHOW_EYE_CARE); }
    get showHydration() { return this.getBool(Keys.SHOW_HYDRATION); }
    get showBreathing() { return this.getBool(Keys.SHOW_BREATHING); }
    get showPosture() { return this.getBool(Keys.SHOW_POSTURE); }
    get allowSkipBreak() { return this.getBool(Keys.ALLOW_SKIP_BREAK); }

    get dailyFocusGoal() { return this.getInt(Keys.DAILY_FOCUS_GOAL); }
    get dailyBreakGoal() { return this.getInt(Keys.DAILY_BREAK_GOAL); }
    get dailyWaterGoal() { return this.getInt(Keys.DAILY_WATER_GOAL); }
    get waterReminderEnabled() { return this.getBool(Keys.WATER_REMINDER_ENABLED); }
    get waterReminderInterval() { return this.getInt(Keys.WATER_REMINDER_INTERVAL); }

    get deepWorkMode() { return this.getBool(Keys.DEEP_WORK_MODE); }
    set deepWorkMode(v) { this.setBool(Keys.DEEP_WORK_MODE, v); }
    get pauseOnScreenShare() { return this.getBool(Keys.PAUSE_ON_SCREEN_SHARE); }
    get gitStreakEnabled() { return this.getBool(Keys.GIT_STREAK_ENABLED); }
    get gitRepoPath() { return this.getString(Keys.GIT_REPO_PATH); }

    get indicatorMode() { return this.getString(Keys.INDICATOR_MODE); }
    get indicatorPosition() { return this.getString(Keys.INDICATOR_POSITION); }

    get analyticsData() { return safeJsonParse(this.getString(Keys.ANALYTICS_DATA), {}); }
    set analyticsData(obj) { this.setString(Keys.ANALYTICS_DATA, JSON.stringify(obj)); }
    get lastActiveDay() { return this.getString(Keys.LAST_ACTIVE_DAY); }
    set lastActiveDay(v) { this.setString(Keys.LAST_ACTIVE_DAY, v); }
    get firstRun() { return this.getBool(Keys.FIRST_RUN); }
    set firstRun(v) { this.setBool(Keys.FIRST_RUN, v); }
    get currentFocusGoal() { return this.getString(Keys.CURRENT_FOCUS_GOAL); }
    set currentFocusGoal(v) { this.setString(Keys.CURRENT_FOCUS_GOAL, v); }

    /**
     * Subscribe to one or many keys. Returns nothing; all handler ids are
     * tracked internally and removed in destroy().
     * @param {string|string[]} keys
     * @param {() => void} callback
     */
    connect(keys, callback) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const key of list) {
            const id = this._settings.connect(`changed::${key}`, callback);
            this._handlerIds.push(id);
        }
    }

    // ---- Import / export ----------------------------------------------------

    /**
     * Serialize every user-facing key (everything except runtime/analytics
     * state) into a plain object suitable for writing to a JSON file.
     */
    exportToObject() {
        const out = { _format: 'focusguard-settings', _version: 1, values: {} };
        const skip = new Set([Keys.ANALYTICS_DATA, Keys.LAST_ACTIVE_DAY, Keys.FIRST_RUN, Keys.CURRENT_FOCUS_GOAL]);
        for (const key of this._settings.list_keys()) {
            if (skip.has(key))
                continue;
            out.values[key] = this._settings.get_value(key).recursiveUnpack();
        }
        return out;
    }

    /**
     * Apply a previously exported object. Unknown keys are ignored and type
     * mismatches are skipped so a malformed file can never corrupt settings.
     * @returns {{applied: number, skipped: number}}
     */
    importFromObject(obj) {
        const values = obj?.values ?? {};
        const known = new Set(this._settings.list_keys());
        let applied = 0;
        let skipped = 0;
        for (const [key, value] of Object.entries(values)) {
            if (!known.has(key)) {
                skipped += 1;
                continue;
            }
            try {
                const variantType = this._settings.get_value(key).get_type_string();
                this._settings.set_value(key, new GLib.Variant(variantType, value));
                applied += 1;
            } catch (e) {
                Logger.warn(`Skipped import of "${key}":`, e.message);
                skipped += 1;
            }
        }
        return { applied, skipped };
    }

    /** Restore user-facing keys to defaults, preserving analytics & runtime state. */
    resetAll() {
        const skip = new Set([Keys.ANALYTICS_DATA, Keys.LAST_ACTIVE_DAY, Keys.FIRST_RUN, Keys.CURRENT_FOCUS_GOAL]);
        for (const key of this._settings.list_keys()) {
            if (!skip.has(key))
                this._settings.reset(key);
        }
    }

    destroy() {
        for (const id of this._handlerIds)
            this._settings.disconnect(id);
        this._handlerIds = [];
        this._settings = null;
    }
}
