/**
 * notificationService.js — native GNOME notifications with actions.
 *
 * Wraps the MessageTray so the rest of the code can fire rich, actionable
 * notifications without touching shell internals. A single Source is reused for
 * the lifetime of the extension and torn down cleanly on disable.
 */
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import { Logger } from '../utils/logger.js';
import { formatDurationLong } from '../utils/helpers.js';

// GNOME 46 rewrote the notification API: Source/Notification constructors moved
// from positional arguments to a params object, urgency/transient became
// constructor properties instead of setters, and Source.showNotification() was
// renamed addNotification(). Detect the shell version once and branch so the
// extension works on GNOME 45 as well as 46–49.
const SHELL_MAJOR = parseInt(Config.PACKAGE_VERSION.split('.')[0], 10) || 46;
const LEGACY_NOTIFICATIONS = SHELL_MAJOR < 46;

export class NotificationService {
    constructor(iconName = 'alarm-symbolic') {
        this._iconName = iconName;
        this._source = null;
    }

    _ensureSource() {
        if (this._source)
            return this._source;
        this._source = LEGACY_NOTIFICATIONS
            ? new MessageTray.Source('FocusGuard', this._iconName)
            : new MessageTray.Source({
                title: 'FocusGuard',
                iconName: this._iconName,
            });
        // Drop our reference if the shell destroys the source.
        this._source.connect('destroy', () => (this._source = null));
        Main.messageTray.add(this._source);
        return this._source;
    }

    /**
     * Generic notification helper.
     * @param {object} opts
     * @param {string} opts.title
     * @param {string} opts.body
     * @param {boolean} [opts.urgent]
     * @param {boolean} [opts.transient]
     * @param {Array<{label:string, callback:Function}>} [opts.actions]
     */
    notify({ title, body, urgent = false, transient = false, actions = [] }) {
        try {
            const source = this._ensureSource();
            const gicon = new Gio.ThemedIcon({ name: this._iconName });
            const urgency = urgent
                ? MessageTray.Urgency.CRITICAL
                : MessageTray.Urgency.NORMAL;

            let notification;
            if (LEGACY_NOTIFICATIONS) {
                // GNOME 45: positional args + setter methods.
                notification = new MessageTray.Notification(
                    source, title, body, { gicon });
                notification.setUrgency(urgency);
                notification.setTransient(transient);
            } else {
                // GNOME 46+: params object.
                notification = new MessageTray.Notification({
                    source, title, body, gicon, urgency, isTransient: transient,
                });
            }

            for (const action of actions)
                notification.addAction(action.label, action.callback);

            // GNOME 45 used showNotification(); 46+ renamed it addNotification().
            if (LEGACY_NOTIFICATIONS)
                source.showNotification(notification);
            else
                source.addNotification(notification);

            return notification;
        } catch (e) {
            Logger.trace(e, 'notify');
            return null;
        }
    }

    /** "Time for a break" with snooze / skip / start-now actions. */
    notifyBreakDue(isLong, { snoozeDurations, onSnooze, onSkip, onStartNow }) {
        const actions = [
            { label: 'Take it now', callback: () => onStartNow?.() },
        ];
        for (const seconds of snoozeDurations) {
            actions.push({
                label: `Snooze ${formatDurationLong(seconds)}`,
                callback: () => onSnooze?.(seconds),
            });
        }
        actions.push({ label: 'Skip', callback: () => onSkip?.() });

        return this.notify({
            title: isLong ? 'Time for a long break' : 'Time for a break',
            body: isLong
                ? 'Step away for a while — stretch, hydrate and rest your eyes.'
                : 'Look away from the screen and give your eyes a rest.',
            actions,
        });
    }

    /** Gentle "break finished" nudge back to work. */
    notifyBreakOver({ onStartWork } = {}) {
        return this.notify({
            title: 'Break finished',
            body: 'Welcome back — ready for another focused block?',
            transient: true,
            actions: onStartWork
                ? [{ label: 'Start focusing', callback: () => onStartWork() }]
                : [],
        });
    }

    /** Escalating reminder for an ignored break. */
    notifyEscalation(count, { onStartNow, onSkip } = {}) {
        return this.notify({
            title: 'Still working?',
            body: count > 1
                ? 'Your break is overdue. A short pause now will keep you sharp.'
                : 'You skipped your break — even 30 seconds helps.',
            urgent: true,
            actions: [
                { label: 'Take a break', callback: () => onStartNow?.() },
                { label: 'Skip', callback: () => onSkip?.() },
            ],
        });
    }

    destroy() {
        if (this._source) {
            this._source.destroy();
            this._source = null;
        }
    }
}
