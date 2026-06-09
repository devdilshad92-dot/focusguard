/**
 * extension.js — FocusGuard entry point and orchestrator.
 *
 * Owns the lifecycle (enable/disable) and wires the independent services
 * together. The golden rule for a leak-free shell extension lives here: every
 * object created in enable() is created fresh, and disable() destroys all of
 * them and drops every reference, leaving no timers, signal handlers, actors or
 * D-Bus proxies behind.
 *
 * Architecture
 * ------------
 *   SettingsManager ── typed access to GSettings
 *   IdleMonitor ────── Mutter idle watches  ─┐
 *   InhibitorDetector  fullscreen/media/share ┤─▶ TimerService (state machine)
 *   AnalyticsService ─ statistics + adaptive ─┘        │ signals
 *                                                       ▼
 *   PanelIndicator · BreakOverlay · Notifications · Sound  (presentation)
 */
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { SettingsManager } from './services/settingsManager.js';
import { IdleMonitor } from './services/idleMonitor.js';
import { InhibitorDetector } from './services/inhibitorDetector.js';
import { TimerService } from './services/timerService.js';
import { AnalyticsService } from './services/analyticsService.js';
import { NotificationService } from './services/notificationService.js';
import { SoundService } from './services/soundService.js';
import { HydrationService } from './services/hydrationService.js';
import { GitStreakService } from './services/gitStreakService.js';
import { PanelIndicator } from './ui/panelIndicator.js';
import { BreakOverlay } from './ui/breakOverlay.js';

import { TimerState, ReminderStyle, Sounds, Keys } from './utils/constants.js';
import { Logger } from './utils/logger.js';

export default class FocusGuardExtension extends Extension {
    enable() {
        Logger.info(`enabling v${this.metadata['version-name'] ?? this.metadata.version}`);

        this._idle = false;
        this._signalIds = [];

        // --- Settings ---
        this._settings = new SettingsManager(this.getSettings());

        // --- Sensors ---
        this._idleMonitor = new IdleMonitor();
        this._inhibitor = new InhibitorDetector();

        // --- Core ---
        this._analytics = new AnalyticsService(this._settings);
        this._timer = new TimerService(this._settings, {
            isIdle: () => this._idle,
            idleTimeMs: () => this._idleMonitor.getIdleTime(),
            getPostpone: () => this._inhibitor.shouldPostpone({
                fullscreen: this._settings.postponeOnFullscreen,
                inhibit: this._settings.postponeOnInhibit,
                screenShare: this._settings.pauseOnScreenShare,
            }),
        });

        // --- Presentation / output ---
        this._sound = new SoundService(this._settings);
        this._notifications = new NotificationService('alarm-symbolic');
        this._hydration = new HydrationService(this._settings);
        this._gitStreak = new GitStreakService(this._settings);
        this._overlay = new BreakOverlay({
            settings: this._settings,
            timer: this._timer,
        });

        this._indicator = new PanelIndicator({
            timer: this._timer,
            settings: this._settings,
            analytics: this._analytics,
            hydration: this._hydration,
            onOpenPrefs: () => this.openPreferences(),
            onAddWater: () => this._onAddWater(),
            onResetWater: () => this._onResetWater(),
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0,
            this._settings.indicatorPosition);

        this._wireIdle();
        this._wireTimer();
        this._wireOverlay();
        this._wireSettings();
        this._wireHydration();

        // Adaptive scheduling: prime the override from recent behaviour.
        this._applyAdaptive();

        this._maybeWelcome();
    }

    disable() {
        Logger.info('disabling');

        // Disconnect explicit signal subscriptions first.
        for (const { obj, id } of this._signalIds ?? [])
            obj.disconnect(id);
        this._signalIds = [];

        // Destroy presentation, then core, then sensors — children before
        // parents, output before state.
        this._indicator?.destroy();
        this._overlay?.destroy();
        this._notifications?.destroy();
        this._sound?.destroy();

        this._timer?.destroy();
        this._analytics?.destroy(); // flushes pending stats to disk
        this._hydration?.destroy();
        this._gitStreak?.destroy();

        this._inhibitor?.destroy();
        this._idleMonitor?.destroy();
        this._settings?.destroy();

        this._indicator = null;
        this._overlay = null;
        this._notifications = null;
        this._sound = null;
        this._timer = null;
        this._analytics = null;
        this._hydration = null;
        this._gitStreak = null;
        this._inhibitor = null;
        this._idleMonitor = null;
        this._settings = null;
    }

    // ---- Wiring helpers -----------------------------------------------------

    _track(obj, signal, callback) {
        const id = obj.connect(signal, callback);
        this._signalIds.push({ obj, id });
        return id;
    }

    _wireIdle() {
        this._idleMonitor.watch(this._settings.idleThreshold);
        this._track(this._idleMonitor, 'idle', () => {
            this._idle = true;
        });
        this._track(this._idleMonitor, 'active', () => {
            this._idle = false;
            this._timer.onUserActive();
        });
    }

    _wireTimer() {
        // Accumulate focused time, one second per WORK tick.
        this._track(this._timer, 'tick', () => {
            if (this._timer.state === TimerState.WORK && this._timer.remaining > 0)
                this._analytics.addFocusSeconds(1);
        });

        this._track(this._timer, 'work-started', () => {
            this._analytics.endFocusBlock();
        });

        // Break is due but auto-start is off: prompt the user.
        this._track(this._timer, 'break-due', (_t, isLong) => {
            this._presentBreakPrompt(isLong);
        });

        // Break actually started (auto or user-initiated).
        this._track(this._timer, 'break-started', (_t, isLong) => {
            this._analytics.recordBreakTaken();
            this._sound.play(Sounds.BREAK_START);
            this._presentBreak(isLong);
        });

        this._track(this._timer, 'break-finished', (_t, skipped) => {
            if (skipped)
                this._analytics.recordBreakSkipped();
            this._sound.play(Sounds.BREAK_END);
            this._overlay.hide();
            if (!skipped && this._wantsNotification())
                this._notifications.notifyBreakOver({
                    onStartWork: () => this._timer.start(),
                });
            this._applyAdaptive();
        });

        this._track(this._timer, 'escalated', count => {
            this._sound.play(Sounds.ESCALATE);
            if (this._wantsNotification()) {
                this._notifications.notifyEscalation(count, {
                    onStartNow: () => this._timer.takeBreakNow(),
                    onSkip: () => this._timer.skipBreak(),
                });
            }
        });
    }

    _wireOverlay() {
        this._track(this._overlay, 'skip-requested', () => {
            this._timer.skipBreak();
        });
    }

    _wireSettings() {
        // Re-arm the idle watch when the threshold changes.
        this._settings.connect(Keys.IDLE_THRESHOLD, () =>
            this._idleMonitor.watch(this._settings.idleThreshold));

        // Re-evaluate adaptive scheduling on relevant changes.
        this._settings.connect(
            [Keys.ADAPTIVE_SCHEDULING, Keys.WORK_DURATION],
            () => this._applyAdaptive());

        // Recompute adaptive when fresh stats land.
        this._track(this._analytics, 'updated', () => this._applyAdaptive());
    }

    _wireHydration() {
        this._track(this._hydration, 'due', () => this._onWaterReminder());
        // Re-arm the interval whenever the user toggles it or changes the period.
        this._settings.connect(
            [Keys.WATER_REMINDER_ENABLED, Keys.WATER_REMINDER_INTERVAL],
            () => this._hydration.sync());
        this._hydration.sync();
    }

    // ---- Break presentation -------------------------------------------------

    _wantsNotification() {
        const style = this._settings.reminderStyle;
        return this._settings.enableNotifications &&
            (style === ReminderStyle.NOTIFICATION || style === ReminderStyle.BOTH);
    }

    _wantsOverlay() {
        const style = this._settings.reminderStyle;
        return style === ReminderStyle.OVERLAY || style === ReminderStyle.BOTH;
    }

    /** Auto-start is off: ask before interrupting. */
    _presentBreakPrompt(isLong) {
        // Simple beep so the break reminder is audible even if the user isn't
        // looking at the screen.
        this._sound.play(Sounds.BREAK_REMINDER);
        if (this._wantsNotification()) {
            this._notifications.notifyBreakDue(isLong, {
                snoozeDurations: this._settings.snoozeDurations,
                onStartNow: () => this._timer.takeBreakNow(),
                onSnooze: seconds => {
                    this._analytics.recordSnooze();
                    this._timer.snooze(seconds);
                },
                onSkip: () => this._timer.skipBreak(),
            });
        } else {
            // No notifications: just begin the break so the timer never stalls.
            this._timer.takeBreakNow();
        }
    }

    /** A break is now running: show the chosen experience. */
    _presentBreak(isLong) {
        if (this._wantsOverlay())
            this._overlay.show(isLong);
        if (this._wantsNotification() && !this._wantsOverlay()) {
            this._notifications.notify({
                title: isLong ? 'Long break started' : 'Break started',
                body: 'Relax — FocusGuard will let you know when it is over.',
                transient: true,
            });
        }
    }

    // ---- Misc ---------------------------------------------------------------

    _onResetWater() {
        this._analytics.resetWaterToday();
        this._indicator?.refreshIfOpen();
    }

    _onAddWater() {
        this._analytics.addWater(1);
        const today = this._analytics.getToday();
        const goal = this._settings.dailyWaterGoal;

        // Reflect the new count in the menu right away if it is still open.
        this._indicator?.refreshIfOpen();

        // Acknowledge every glass so the click has visible feedback — gated only
        // on notifications being enabled (this is a deliberate user action, not a
        // break reminder, so it ignores the break reminder *style*).
        if (!this._settings.enableNotifications)
            return;
        this._notifications.notify(today.water >= goal
            ? {
                title: 'Hydration goal reached 💧',
                body: `${today.water} of ${goal} glasses today — nicely done.`,
                transient: true,
            }
            : {
                title: 'Glass logged 💧',
                body: `${today.water} of ${goal} glasses today.`,
                transient: true,
            });
    }

    /** A hydration interval elapsed — nudge the user, but only when welcome. */
    _onWaterReminder() {
        // Respect the "never annoying" contract: stay quiet while the user is
        // away, heads-down in deep work, or while breaks are being postponed
        // (fullscreen / media / call / screen share).
        if (this._idle || this._settings.deepWorkMode)
            return;
        if (this._inhibitor.shouldPostpone({
            fullscreen: this._settings.postponeOnFullscreen,
            inhibit: this._settings.postponeOnInhibit,
            screenShare: this._settings.pauseOnScreenShare,
        }).postpone)
            return;

        const today = this._analytics.getToday();
        const goal = this._settings.dailyWaterGoal;
        if (today.water >= goal)
            return; // goal already met today — no need to nag

        if (!this._settings.enableNotifications)
            return;
        this._notifications.notify({
            title: 'Time to hydrate 💧',
            body: `${today.water} of ${goal} glasses so far — grab a glass of water.`,
            actions: [{ label: 'Log a glass', callback: () => this._onAddWater() }],
        });
    }

    _applyAdaptive() {
        if (!this._settings.adaptiveScheduling) {
            this._timer.setWorkOverride(null);
            return;
        }
        const suggestion =
            this._analytics.suggestedWorkDuration(this._settings.workDuration);
        this._timer.setWorkOverride(suggestion);
    }

    _maybeWelcome() {
        if (!this._settings.firstRun)
            return;
        this._settings.firstRun = false;
        this._notifications.notify({
            title: 'FocusGuard is ready',
            body: 'Click the panel icon to start a focus session. ' +
                'Tune everything in Settings.',
            actions: [{
                label: 'Open settings',
                callback: () => this.openPreferences(),
            }],
        });
    }
}
