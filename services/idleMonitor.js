/**
 * idleMonitor.js — wraps Mutter's core idle monitor.
 *
 * The shell exposes a `Meta.IdleMonitor` via `global.backend.get_core_idle_monitor()`.
 * It lets us register:
 *   - an "idle watch"   that fires once the user has been inactive for N ms;
 *   - a "user active watch" that fires the next time the user touches input.
 *
 * We translate those low-level callbacks into two clean signals — `idle` and
 * `active` — and expose `getIdleTime()` for one-shot polling. All watches are
 * removed on destroy so we never leak callbacks into Mutter.
 */
import GObject from 'gi://GObject';
import { Logger } from '../utils/logger.js';

export const IdleMonitor = GObject.registerClass({
    GTypeName: 'FocusGuardIdleMonitor',
    Signals: {
        'idle': {},    // user has crossed the idle threshold
        'active': {},  // user came back from idle
    },
}, class IdleMonitor extends GObject.Object {
    _init() {
        super._init();
        this._monitor = global.backend.get_core_idle_monitor();
        this._idleWatchId = 0;
        this._activeWatchId = 0;
        this._thresholdMs = 0;
        this._isIdle = false;
    }

    get isIdle() {
        return this._isIdle;
    }

    /** Current idle time in milliseconds (0 while the user is active). */
    getIdleTime() {
        try {
            return this._monitor.get_idletime();
        } catch (e) {
            Logger.trace(e, 'getIdleTime');
            return 0;
        }
    }

    /**
     * (Re)arm the idle watch for the given threshold in seconds. Safe to call
     * repeatedly — the previous watch is torn down first.
     */
    watch(thresholdSeconds) {
        this._thresholdMs = Math.max(1000, thresholdSeconds * 1000);
        this._clearIdleWatch();
        this._idleWatchId = this._monitor.add_idle_watch(this._thresholdMs, () => {
            this._isIdle = true;
            this._armActiveWatch();
            this.emit('idle');
        });
    }

    _armActiveWatch() {
        this._clearActiveWatch();
        this._activeWatchId = this._monitor.add_user_active_watch(() => {
            // Fires exactly once, then Mutter drops it.
            this._activeWatchId = 0;
            this._isIdle = false;
            this.emit('active');
        });
    }

    _clearIdleWatch() {
        if (this._idleWatchId) {
            this._monitor.remove_watch(this._idleWatchId);
            this._idleWatchId = 0;
        }
    }

    _clearActiveWatch() {
        if (this._activeWatchId) {
            this._monitor.remove_watch(this._activeWatchId);
            this._activeWatchId = 0;
        }
    }

    destroy() {
        this._clearIdleWatch();
        this._clearActiveWatch();
        this._monitor = null;
    }
});
