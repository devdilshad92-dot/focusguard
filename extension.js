/**
 * extension.js — FocusGuard entry point and orchestrator.
 *
 * Owns the lifecycle (enable/disable) and wires the independent services
 * together.
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
import { GitStreakService } from './services/gitStreakService.js';
import { PanelIndicator } from './ui/panelIndicator.js';
import { BreakOverlay } from './ui/breakOverlay.js';
import { ResetWaterDialog, GoalDialog, WeeklyReportDialog } from './ui/dialogs.js';

import { TimerState, ReminderStyle, Sounds, Keys } from './utils/constants.js';
import { Logger } from './utils/logger.js';

export default class FocusGuardExtension extends Extension {
    enable() {
        Logger.info('enabling focusguard@dilshad.dev');

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
        this._gitStreak = new GitStreakService(this._settings);
        this._overlay = new BreakOverlay({
            settings: this._settings,
            timer: this._timer,
        });

        this._indicator = new PanelIndicator({
            timer: this._timer,
            settings: this._settings,
            analytics: this._analytics,
            onOpenPrefs: () => this.openPreferences(),
            onAddWater: () => this._onAddWater(),
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0,
            this._settings.indicatorPosition);

        this._wireIdle();
        this._wireTimer();
        this._wireOverlay();
        this._wireSettings();
        this._wireHydration();
        this._wireIndicatorActions();

        // Adaptive scheduling: prime the override from recent behaviour.
        this._applyAdaptive();

        this._maybeWelcome();
    }

    disable() {
        Logger.info('disabling');

        for (const { obj, id } of this._signalIds ?? [])
            obj.disconnect(id);
        this._signalIds = [];

        this._indicator?.destroy();
        this._overlay?.destroy();
        this._notifications?.destroy();
        this._sound?.destroy();

        this._timer?.destroy();
        this._analytics?.destroy();
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
        this._track(this._timer, 'tick', () => {
            if (this._timer.state === TimerState.WORK && this._timer.remaining > 0)
                this._analytics.addFocusSeconds(1);
        });

        this._track(this._timer, 'work-started', () => {
            this._analytics.endFocusBlock();
        });

        this._track(this._timer, 'break-due', (_t, isLong) => {
            this._presentBreakPrompt(isLong);
        });

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

        this._track(this._timer, 'eye-break-started', () => {
            this._analytics.recordEyeReminderShown();
            this._sound.play(Sounds.BREAK_START);
            this._presentEyeBreak();
        });

        this._track(this._timer, 'eye-break-completed', () => {
            this._analytics.recordEyeReminderCompleted();
            this._sound.play(Sounds.BREAK_END);
        });

        this._track(this._timer, 'eye-break-skipped', () => {
            this._analytics.recordEyeReminderSkipped();
        });

        this._track(this._timer, 'eye-break-finished', () => {
            this._overlay.hide();
        });

        this._track(this._timer, 'user-returned-from-idle', () => {
            this._presentWelcomeBackPrompt();
        });
    }

    _wireOverlay() {
        this._track(this._overlay, 'skip-requested', () => {
            this._timer.skipBreak();
        });
    }

    _wireSettings() {
        this._track(this._settings.gio, `changed::${Keys.IDLE_THRESHOLD}`, () =>
            this._idleMonitor.watch(this._settings.idleThreshold));

        const applyAdaptiveCb = () => this._applyAdaptive();
        this._track(this._settings.gio, `changed::${Keys.ADAPTIVE_SCHEDULING}`, applyAdaptiveCb);
        this._track(this._settings.gio, `changed::${Keys.WORK_DURATION}`, applyAdaptiveCb);

        this._track(this._analytics, 'updated', applyAdaptiveCb);
    }

    _wireHydration() {
        this._track(this._timer, 'hydration-due', () => this._onWaterReminder());
        const refreshCb = () => this._timer.refreshFromSettings();
        this._track(this._settings.gio, `changed::${Keys.WATER_REMINDER_ENABLED}`, refreshCb);
        this._track(this._settings.gio, `changed::${Keys.WATER_REMINDER_INTERVAL}`, refreshCb);
    }

    _wireIndicatorActions() {
        this._track(this._indicator, 'start-session-requested', () => {
            const dialog = new GoalDialog((goal) => {
                this._settings.currentFocusGoal = goal || '';
                this._timer.start();
                this._indicator.refreshIfOpen();
            });
            dialog.open();
        });

        this._track(this._indicator, 'reset-water-requested', () => {
            const dialog = new ResetWaterDialog(() => {
                this._onResetWater();
            });
            dialog.open();
        });

        this._track(this._indicator, 'set-goal-requested', () => {
            const dialog = new GoalDialog((goal) => {
                this._settings.currentFocusGoal = goal;
                this._indicator.refreshIfOpen();
            });
            dialog.open();
        });

        this._track(this._indicator, 'weekly-report-requested', () => {
            const stats = this._analytics.getWeeklyReportStats();
            const dialog = new WeeklyReportDialog(stats);
            dialog.open();
        });
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

    _presentBreakPrompt(isLong) {
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
            this._timer.takeBreakNow();
        }
    }

    _presentBreak(isLong) {
        if (this._wantsOverlay())
            this._overlay.show(isLong ? 'long' : 'short');
        if (this._wantsNotification() && !this._wantsOverlay()) {
            this._notifications.notify({
                title: isLong ? 'Long break started' : 'Break started',
                body: 'Relax — FocusGuard will let you know when it is over.',
                transient: true,
            });
        }
    }

    _presentEyeBreak() {
        if (this._wantsOverlay()) {
            this._overlay.show('eye');
        } else if (this._wantsNotification()) {
            this._notifications.notify({
                title: 'Look away for 20 seconds 👁️',
                body: 'Focus on something 20 feet away to rest your eyes.',
                actions: [
                    {
                        label: 'Snooze',
                        callback: () => this._timer.snoozeEyeBreak()
                    },
                    {
                        label: 'Skip',
                        callback: () => this._timer.skipEyeBreak()
                    }
                ]
            });
        }
    }

    _presentWelcomeBackPrompt() {
        if (!this._settings.enableNotifications) {
            this._timer.resumeFromIdle();
            return;
        }

        this._notifications.notify({
            title: 'Welcome back',
            body: 'Resume Focus Session?',
            actions: [
                {
                    label: 'Resume',
                    callback: () => {
                        Logger.info('User chose to resume focus session');
                        this._timer.resumeFromIdle();
                    }
                },
                {
                    label: 'Dismiss',
                    callback: () => {
                        Logger.info('User dismissed resume prompt. Pause reason: user went idle.');
                        this._timer.dismissFromIdle();
                    }
                }
            ]
        });
    }

    // ---- Misc ---------------------------------------------------------------

    _onResetWater() {
        this._analytics.resetWaterToday();
        this._timer.resetHydrationTimer();
        this._indicator?.refreshIfOpen();
    }

    _onAddWater() {
        this._analytics.addWater(1);
        this._timer.resetHydrationTimer();
        const today = this._analytics.getToday();
        const goal = this._settings.dailyWaterGoal;

        this._indicator?.refreshIfOpen();

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

    _onWaterReminder() {
        if (this._idle)
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
            return;

        if (!this._settings.enableNotifications)
            return;

        this._analytics.recordHydrationReminderCompleted();

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
