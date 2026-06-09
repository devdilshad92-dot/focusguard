/**
 * hydrationService.js — periodic "drink some water" reminder.
 *
 * Owns a single GLib interval that fires a `due` signal every N minutes while
 * enabled. It is intentionally dumb: it knows nothing about the daily goal,
 * idle state or notifications. The host (extension.js) decides whether a given
 * `due` should actually surface a reminder, keeping this service trivial to
 * reason about and free of shell-only imports.
 */
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

export const HydrationService = GObject.registerClass({
    GTypeName: 'FocusGuardHydrationService',
    Signals: {
        'due': {},   // an interval elapsed; host decides whether to remind
    },
}, class HydrationService extends GObject.Object {
    _init(settings) {
        super._init();
        this._settings = settings;
        this._timeoutId = 0;
    }

    /**
     * (Re)arm or stop the interval to match the current settings. Safe to call
     * repeatedly — e.g. whenever the enabled flag or interval changes.
     */
    sync() {
        this.stop();
        if (!this._settings?.waterReminderEnabled)
            return;
        this._intervalSec = Math.max(60, this._settings.waterReminderInterval * 60);
        this._nextFireAt  = Math.floor(Date.now() / 1000) + this._intervalSec;
        this._timeoutId   = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, this._intervalSec, () => {
                this.emit('due');
                this._nextFireAt = Math.floor(Date.now() / 1000) + this._intervalSec;
                return GLib.SOURCE_CONTINUE;
            });
    }

    /** Seconds until the next hydration reminder fires (0 when disabled). */
    get remainingSeconds() {
        if (!this._timeoutId || !this._nextFireAt)
            return 0;
        return Math.max(0, this._nextFireAt - Math.floor(Date.now() / 1000));
    }

    stop() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId  = 0;
            this._nextFireAt = 0;
        }
    }

    destroy() {
        this.stop();
        this._settings = null;
    }
});
