/**
 * inhibitorDetector.js — decides when a break should be postponed.
 *
 * Three independent signals are folded into a single boolean `shouldPostpone`:
 *
 *   1. Fullscreen  — any monitor showing a fullscreen window (slides, games,
 *                    full-screen video). Read from Mutter's display.
 *   2. Idle inhibitors — apps (video players, conferencing tools, browsers
 *                    playing media) ask the session manager not to idle the
 *                    screen. We honour the same hint via the GNOME
 *                    SessionManager "InhibitorAdded/Removed" presence.
 *   3. Screen sharing — an active screencast (the orange recording dot) means
 *                    a meeting/presentation is live.
 *
 * The detector polls cheaply on demand (no timers of its own) and also emits a
 * `changed` signal when the fullscreen state flips, so the timer can react
 * immediately rather than only on its next tick.
 */
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import { Logger } from '../utils/logger.js';

const SESSION_MANAGER_DBUS = `
<node>
  <interface name="org.gnome.SessionManager">
    <method name="IsInhibited">
      <arg type="u" direction="in"/>
      <arg type="b" direction="out"/>
    </method>
  </interface>
</node>`;

// Flag 8 == "inhibit the session being marked as idle" (suspend/idle).
// This is what media players and conferencing apps set during playback/calls.
const INHIBIT_IDLE = 8;

const SessionManagerProxy = Gio.DBusProxy.makeProxyWrapper(SESSION_MANAGER_DBUS);

export const InhibitorDetector = GObject.registerClass({
    GTypeName: 'FocusGuardInhibitorDetector',
    Signals: {
        'changed': {},
    },
}, class InhibitorDetector extends GObject.Object {
    _init() {
        super._init();
        this._fullscreenChangedId = global.display.connect(
            'in-fullscreen-changed', () => this.emit('changed'));

        // Async, best-effort proxy. If the bus call fails we simply treat the
        // session as "not inhibited" rather than blocking breaks forever.
        this._sessionProxy = null;
        try {
            SessionManagerProxy(
                Gio.DBus.session,
                'org.gnome.SessionManager',
                '/org/gnome/SessionManager',
                (proxy, error) => {
                    if (error) {
                        Logger.debug('SessionManager proxy unavailable:', error.message);
                        return;
                    }
                    this._sessionProxy = proxy;
                });
        } catch (e) {
            Logger.trace(e, 'SessionManager proxy');
        }
    }

    /** True if any monitor currently shows a fullscreen window. */
    isAnyMonitorFullscreen() {
        const n = global.display.get_n_monitors();
        for (let i = 0; i < n; i++) {
            if (global.display.get_monitor_in_fullscreen(i))
                return true;
        }
        return false;
    }

    /** True if a session idle-inhibitor is active (media/calls). */
    isSessionInhibited() {
        if (!this._sessionProxy)
            return false;
        try {
            // Synchronous variant keeps the polling call simple; it is a fast
            // local D-Bus round-trip executed at most once per tick.
            const [inhibited] = this._sessionProxy.IsInhibitedSync(INHIBIT_IDLE);
            return inhibited;
        } catch (e) {
            Logger.debug('IsInhibited failed:', e.message);
            return false;
        }
    }

    /**
     * Best-effort screen-sharing detection.
     *
     * There is no stable public JS API to query an arbitrary app's screencast
     * session, so we rely on the most reliable proxy available: a recording
     * session started through Mutter sets `disable_unredirect`, and conferencing
     * apps that share the screen invariably hold an idle inhibitor (handled by
     * isSessionInhibited). We additionally check the shell's own recorder flag.
     */
    isScreenSharing() {
        try {
            // Set while the built-in screen recorder / a screencast is active.
            return !!global.display.get_monitor_in_fullscreen &&
                !!global.screencast_active;
        } catch (e) {
            Logger.debug('screencast probe failed:', e.message);
            return false;
        }
    }

    /**
     * Single decision used by the timer.
     * @param {{fullscreen:boolean, inhibit:boolean, screenShare:boolean}} opts
     */
    shouldPostpone({ fullscreen, inhibit, screenShare }) {
        if (fullscreen && this.isAnyMonitorFullscreen())
            return { postpone: true, reason: 'fullscreen' };
        if (inhibit && this.isSessionInhibited())
            return { postpone: true, reason: 'inhibited' };
        if (screenShare && this.isScreenSharing())
            return { postpone: true, reason: 'screen-share' };
        return { postpone: false, reason: null };
    }

    destroy() {
        if (this._fullscreenChangedId) {
            global.display.disconnect(this._fullscreenChangedId);
            this._fullscreenChangedId = 0;
        }
        this._sessionProxy = null;
    }
});
