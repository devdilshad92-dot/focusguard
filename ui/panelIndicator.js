/**
 * panelIndicator.js — the top-bar button and its popup menu.
 *
 * Shows a state icon plus the live countdown, and offers the full set of quick
 * controls (start/pause, take break, skip, snooze, deep-work, hydration) along
 * with a glance at today's stats. Everything is rebuilt reactively from timer
 * signals; the indicator owns no timers of its own.
 */
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { TimerState, IndicatorMode, SuspendReason } from '../utils/constants.js';
import { formatCountdown, formatDurationLong } from '../utils/helpers.js';

/** Symbolic icon per state — all ship with the standard icon theme. */
const STATE_ICON = {
    [TimerState.IDLE]: 'media-playback-stop-symbolic',
    [TimerState.WORK]: 'focus-windows-symbolic',
    [TimerState.BREAK]: 'face-smile-symbolic',
    [TimerState.LONG_BREAK]: 'weather-clear-symbolic',
    [TimerState.PAUSED]: 'media-playback-pause-symbolic',
    [TimerState.SUSPENDED]: 'media-playback-pause-symbolic',
};

const STATE_LABEL = {
    [TimerState.IDLE]: 'Idle',
    [TimerState.WORK]: 'Focusing',
    [TimerState.BREAK]: 'Break',
    [TimerState.LONG_BREAK]: 'Long break',
    [TimerState.PAUSED]: 'Paused',
    [TimerState.SUSPENDED]: 'Suspended',
};

const SUSPEND_TEXT = {
    [SuspendReason.IDLE]: 'Paused — you stepped away',
    [SuspendReason.FULLSCREEN]: 'Paused — fullscreen app',
    [SuspendReason.INHIBITED]: 'Paused — media / call in progress',
    [SuspendReason.SCREEN_SHARE]: 'Paused — screen sharing',
    [SuspendReason.DEEP_WORK]: 'Deep work — reminders off',
};

export const PanelIndicator = GObject.registerClass({
    GTypeName: 'FocusGuardPanelIndicator',
}, class PanelIndicator extends PanelMenu.Button {
    _init({ timer, settings, analytics, gitStreak, onOpenPrefs, onAddWater }) {
        super._init(0.0, 'FocusGuard', false);

        this._timer = timer;
        this._settings = settings;
        this._analytics = analytics;
        this._gitStreak = gitStreak;
        this._onOpenPrefs = onOpenPrefs;
        this._onAddWater = onAddWater;

        this._baseStatsText = '';
        this._gitStatsLine = '';

        this._buildButton();
        this._buildMenu();
        this._connectSignals();
        this.update();
    }

    // ---- Panel button content ----------------------------------------------

    _buildButton() {
        this._box = new St.BoxLayout({
            style_class: 'panel-status-menu-box focusguard-indicator',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._icon = new St.Icon({
            icon_name: STATE_ICON[TimerState.IDLE],
            style_class: 'system-status-icon focusguard-icon',
        });
        this._label = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'focusguard-countdown',
        });
        this._box.add_child(this._icon);
        this._box.add_child(this._label);
        this.add_child(this._box);
    }

    // ---- Popup menu ---------------------------------------------------------

    _buildMenu() {
        // Header: state + countdown.
        this._headerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        const header = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style_class: 'focusguard-menu-header',
        });
        this._headerTitle = new St.Label({
            text: 'FocusGuard',
            style_class: 'focusguard-header-title',
        });
        this._headerSubtitle = new St.Label({
            text: '',
            style_class: 'focusguard-header-subtitle',
        });
        this._progressBar = new St.Widget({
            style_class: 'focusguard-progress-track',
            x_expand: true,
            height: 6,
            layout_manager: new Clutter.BinLayout(),
        });
        this._progressFill = new St.Widget({
            style_class: 'focusguard-progress-fill',
            x_align: Clutter.ActorAlign.START,
        });
        this._progressBar.add_child(this._progressFill);
        // Re-apply the fill width whenever the track is (re)allocated, so the
        // bar is correct even on the very first menu open before layout settles.
        this._progressFrac = 0;
        this._progressBar.connect('notify::width', () => this._applyProgressWidth());
        header.add_child(this._headerTitle);
        header.add_child(this._headerSubtitle);
        header.add_child(this._progressBar);
        this._headerItem.add_child(header);
        this.menu.addMenuItem(this._headerItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Primary action (start / pause / resume).
        this._primaryItem = new PopupMenu.PopupImageMenuItem(
            'Start focusing', 'media-playback-start-symbolic');
        this._primaryItem.connect('activate', () => this._timer.togglePause());
        this.menu.addMenuItem(this._primaryItem);

        // Take a break now.
        this._breakItem = new PopupMenu.PopupImageMenuItem(
            'Take a break now', 'face-smile-symbolic');
        this._breakItem.connect('activate', () => this._timer.takeBreakNow());
        this.menu.addMenuItem(this._breakItem);

        // Skip break / stop session.
        this._skipItem = new PopupMenu.PopupImageMenuItem(
            'Skip break', 'media-skip-forward-symbolic');
        this._skipItem.connect('activate', () => this._timer.skipBreak());
        this.menu.addMenuItem(this._skipItem);

        // Snooze submenu (populated from settings each open).
        this._snoozeSub = new PopupMenu.PopupSubMenuMenuItem('Snooze break');
        this.menu.addMenuItem(this._snoozeSub);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Deep work toggle.
        this._deepWorkItem = new PopupMenu.PopupSwitchMenuItem(
            'Deep work mode', this._settings.deepWorkMode);
        this._deepWorkItem.connect('toggled', (_i, state) => {
            this._settings.deepWorkMode = state;
        });
        this.menu.addMenuItem(this._deepWorkItem);

        // Hydration counter.
        this._waterItem = new PopupMenu.PopupImageMenuItem(
            'Log a glass of water', 'list-add-symbolic');
        this._waterItem.connect('activate', () => this._onAddWater?.());
        this.menu.addMenuItem(this._waterItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Today's stats (read-only).
        this._statsItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        this._statsLabel = new St.Label({
            text: '',
            style_class: 'focusguard-stats',
            x_expand: true,
        });
        this._statsItem.add_child(this._statsLabel);
        this.menu.addMenuItem(this._statsItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Settings.
        const prefsItem = new PopupMenu.PopupImageMenuItem(
            'Settings', 'preferences-system-symbolic');
        prefsItem.connect('activate', () => this._onOpenPrefs?.());
        this.menu.addMenuItem(prefsItem);

        // Rebuild dynamic bits whenever the menu opens. The git fetch (a
        // subprocess) happens only here — once per open — not on every tick.
        this.menu.connect('open-state-changed', (_m, open) => {
            if (open) {
                this._refreshMenu();
                this._refreshGitStats();
            }
        });
    }

    _rebuildSnoozeSubmenu() {
        this._snoozeSub.menu.removeAll();
        for (const seconds of this._settings.snoozeDurations) {
            const item = new PopupMenu.PopupMenuItem(
                `Snooze ${formatDurationLong(seconds)}`);
            item.connect('activate', () => this._timer.snooze(seconds));
            this._snoozeSub.menu.addMenuItem(item);
        }
        const skipOnce = new PopupMenu.PopupMenuItem('Skip this one');
        skipOnce.connect('activate', () => this._timer.skipBreak());
        this._snoozeSub.menu.addMenuItem(skipOnce);
    }

    // ---- Reactive updates ---------------------------------------------------

    _connectSignals() {
        this._timerHandlers = [
            this._timer.connect('tick', () => this.update()),
            this._timer.connect('phase-changed', () => this.update()),
            this._timer.connect('suspended', () => this.update()),
            this._timer.connect('resumed', () => this.update()),
        ];
        this._settingsHandlerKeys = ['deep-work-mode', 'indicator-mode'];
        this._settings.connect(this._settingsHandlerKeys, () => this.update());
    }

    /** Update the panel button (called every tick — keep it cheap). */
    update() {
        const state = this._timer.state;
        const mode = this._settings.indicatorMode;

        // Visibility / content per indicator mode.
        if (mode === IndicatorMode.HIDDEN) {
            this.visible = false;
            return;
        }
        this.visible = true;

        this._icon.icon_name = STATE_ICON[state] ?? STATE_ICON[TimerState.IDLE];
        this._icon.visible = mode !== IndicatorMode.COUNTDOWN_ONLY;

        const showCountdown = mode === IndicatorMode.ICON_AND_COUNTDOWN ||
            mode === IndicatorMode.COUNTDOWN_ONLY;
        if (showCountdown && this._timer.isRunning) {
            this._label.text = formatCountdown(this._timer.remaining);
            this._label.visible = true;
        } else if (showCountdown && state === TimerState.SUSPENDED) {
            this._label.text = '⏸';
            this._label.visible = true;
        } else {
            this._label.visible = false;
        }

        // Style hook so the CSS can colour break vs. work.
        this._box.remove_style_class_name('focusguard-state-work');
        this._box.remove_style_class_name('focusguard-state-break');
        if (state === TimerState.WORK)
            this._box.add_style_class_name('focusguard-state-work');
        else if (state === TimerState.BREAK || state === TimerState.LONG_BREAK)
            this._box.add_style_class_name('focusguard-state-break');

        if (this.menu.isOpen)
            this._refreshMenu();
    }

    /** Update the popup contents (only while it is open). */
    _refreshMenu() {
        const state = this._timer.state;

        this._headerTitle.text = STATE_LABEL[state] ?? 'FocusGuard';
        if (state === TimerState.SUSPENDED) {
            this._headerSubtitle.text =
                SUSPEND_TEXT[this._timer.suspendReason] ?? 'Paused';
        } else if (this._timer.isRunning) {
            this._headerSubtitle.text = `${formatCountdown(this._timer.remaining)} remaining`;
        } else if (state === TimerState.PAUSED) {
            this._headerSubtitle.text = `Paused at ${formatCountdown(this._timer.remaining)}`;
        } else {
            this._headerSubtitle.text = 'Ready when you are';
        }

        // Progress fill width (BinLayout child sized as a fraction of track).
        this._progressFrac = this._timer.progress;
        this._applyProgressWidth();

        // Primary action label/icon.
        if (state === TimerState.PAUSED) {
            this._primaryItem.label.text = 'Resume';
            this._primaryItem.setIcon('media-playback-start-symbolic');
        } else if (this._timer.isRunning || state === TimerState.SUSPENDED) {
            this._primaryItem.label.text = 'Pause';
            this._primaryItem.setIcon('media-playback-pause-symbolic');
        } else {
            this._primaryItem.label.text = 'Start focusing';
            this._primaryItem.setIcon('media-playback-start-symbolic');
        }

        const inBreak = state === TimerState.BREAK || state === TimerState.LONG_BREAK;
        this._breakItem.visible = !inBreak;
        this._skipItem.visible = inBreak || this._timer.isRunning;
        this._skipItem.label.text = inBreak ? 'End break early' : 'Skip next break';
        this._snoozeSub.visible = this._timer.isRunning && !inBreak;

        this._deepWorkItem.setToggleState(this._settings.deepWorkMode);
        this._rebuildSnoozeSubmenu();
        this._refreshStats();
    }

    _applyProgressWidth() {
        if (!this._progressBar || !this._progressFill)
            return;
        const trackWidth = this._progressBar.width;
        this._progressFill.width = Math.max(0,
            Math.round(trackWidth * (this._progressFrac ?? 0)));
    }

    _refreshStats() {
        const today = this._analytics.getToday();
        const focusGoal = this._settings.dailyFocusGoal;
        const focusPct = Math.min(100, Math.round(today.focus / focusGoal * 100));
        const streak = this._analytics.getCurrentStreak(focusGoal);
        let text =
            `Today  ·  ${formatDurationLong(today.focus)} focus (${focusPct}% of goal)\n` +
            `${today.breaksTaken} breaks  ·  ${today.water} glasses of water`;
        if (streak > 0)
            text += `\n🔥 ${streak}-day focus streak`;
        this._baseStatsText = text;
        this._statsLabel.text = this._gitStatsLine
            ? `${text}\n${this._gitStatsLine}`
            : text;
    }

    /** Git commit streak (async subprocess) — called once per menu open. */
    _refreshGitStats() {
        if (!this._gitStreak?.enabled) {
            this._gitStatsLine = '';
            return;
        }
        this._gitStreak.getStats().then(({ today: commits, streak: gitStreak }) => {
            if (!this._statsLabel || !this.menu.isOpen)
                return;
            this._gitStatsLine = (commits || gitStreak)
                ? `${commits} commits today · ${gitStreak}-day commit streak`
                : '';
            if (this._gitStatsLine)
                this._statsLabel.text = `${this._baseStatsText}\n${this._gitStatsLine}`;
        }).catch(() => {});
    }

    destroy() {
        for (const id of this._timerHandlers ?? [])
            this._timer.disconnect(id);
        this._timerHandlers = null;
        super.destroy();
    }
});
