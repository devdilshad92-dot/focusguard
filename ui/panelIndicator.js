/**
 * panelIndicator.js — top-bar icon and dropdown dashboard.
 *
 * Panel: a single static blue icon. No text, no counters.
 * Dropdown: a live dashboard with HH:MM:SS timers updating every second.
 */
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { TimerState } from '../utils/constants.js';
import { formatHMS } from '../utils/helpers.js';

const STATE_HEADING = {
    [TimerState.IDLE]:       'Ready to focus',
    [TimerState.WORK]:       'Focusing',
    [TimerState.BREAK]:      'On Break',
    [TimerState.LONG_BREAK]: 'Long Break',
    [TimerState.EYE_BREAK]:  'Eye Care Break',
    [TimerState.PAUSED]:     'Paused',
    [TimerState.SUSPENDED]:  'Auto-paused',
};

export const PanelIndicator = GObject.registerClass({
    GTypeName: 'FocusGuardPanelIndicator',
    Signals: {
        'reset-water-requested': {},
        'set-goal-requested': {},
        'weekly-report-requested': {},
        'start-session-requested': {},
    },
}, class PanelIndicator extends PanelMenu.Button {
    _init({ timer, settings, analytics, onOpenPrefs, onAddWater }) {
        super._init(0.0, 'FocusGuard', false);

        this._timer      = timer;
        this._settings   = settings;
        this._analytics  = analytics;
        this._onOpenPrefs  = onOpenPrefs;
        this._onAddWater   = onAddWater;

        this._buildButton();
        this._buildMenu();
        this._connectSignals();
        this.update();
    }

    _buildButton() {
        this._icon = new St.Icon({
            icon_name: 'focus-windows-symbolic',
            style_class: 'system-status-icon focusguard-panel-icon',
        });
        this.add_child(this._icon);
    }

    _buildMenu() {
        // ── Live timer section ───────────────────────────────────────────
        this._stateHeading = this._addHeading();
        this._cycleInfo = this._addCycleInfo();
        this._focusSessionValue    = this._addTimerRow('Focus Session');
        this._nextBreakValue       = this._addTimerRow('Next Break');
        this._eyeReminderValue     = this._addTimerRow('Eye Reminder');
        this._hydrationValue       = this._addTimerRow('Hydration Reminder');

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Focus Goal ───────────────────────────────────────────────────
        this._focusGoalValue       = this._addTimerRow('Current Focus Goal');

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Daily stats section ──────────────────────────────────────────
        this._todayFocusValue        = this._addTimerRow("Today's Focus");
        this._focusScoreValue        = this._addTimerRow("Today's Focus Score");
        this._burnoutRiskValue       = this._addTimerRow("Burnout Risk");
        this._recoveryScoreValue     = this._addTimerRow("Recovery Score");
        this._waterConsumedValue     = this._addTimerRow('Water Consumed');
        this._lastWaterLoggedValue   = this._addTimerRow('Last Water Logged');
        this._eyeCompletedValue      = this._addTimerRow('Eye Breaks Completed');
        this._hydrationCompletedValue = this._addTimerRow('Hydration Completed');

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Actions ──────────────────────────────────────────────────────
        this._startItem = new PopupMenu.PopupMenuItem('▶  Start Focus Session');
        this._startItem.connect('activate', () => this.emit('start-session-requested'));
        this.menu.addMenuItem(this._startItem);

        this._resumeItem = new PopupMenu.PopupMenuItem('▶  Resume Session');
        this._resumeItem.connect('activate', () => {
            if (this._timer.idlePendingResume)
                this._timer.resumeFromIdle();
            else
                this._timer.resume();
        });
        this.menu.addMenuItem(this._resumeItem);

        this._pauseItem = new PopupMenu.PopupMenuItem('⏸  Pause Timers');
        this._pauseItem.connect('activate', () => this._timer.pause());
        this.menu.addMenuItem(this._pauseItem);

        this._skipItem = new PopupMenu.PopupMenuItem('⏭  Skip Current Reminder');
        this._skipItem.connect('activate', () => this._timer.skipBreak());
        this.menu.addMenuItem(this._skipItem);

        this._addWaterItem = new PopupMenu.PopupMenuItem('💧  Add Glass of Water');
        this._addWaterItem.connect('activate', () => this._onAddWater?.());
        this.menu.addMenuItem(this._addWaterItem);

        this._resetWaterItem = new PopupMenu.PopupMenuItem('🔄  Reset Water Counter');
        this._resetWaterItem.connect('activate', () => this.emit('reset-water-requested'));
        this.menu.addMenuItem(this._resetWaterItem);

        this._setGoalItem = new PopupMenu.PopupMenuItem('🎯  Set Focus Goal');
        this._setGoalItem.connect('activate', () => this.emit('set-goal-requested'));
        this.menu.addMenuItem(this._setGoalItem);

        this._weeklyReportItem = new PopupMenu.PopupMenuItem('📊  Weekly Productivity Report');
        this._weeklyReportItem.connect('activate', () => this.emit('weekly-report-requested'));
        this.menu.addMenuItem(this._weeklyReportItem);

        this._resetItem = new PopupMenu.PopupMenuItem('🔄  Reset Focus Session');
        this._resetItem.connect('activate', () => this._timer.stop());
        this.menu.addMenuItem(this._resetItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Settings ─────────────────────────────────────────────────────
        const prefsItem = new PopupMenu.PopupMenuItem('⚙  Settings');
        prefsItem.connect('activate', () => this._onOpenPrefs?.());
        this.menu.addMenuItem(prefsItem);
    }

    _addCycleInfo() {
        const item  = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        const label = new St.Label({
            text: '',
            style_class: 'focusguard-cycle-info',
            x_expand: true,
        });
        item.add_child(label);
        this.menu.addMenuItem(item);
        return label;
    }

    _addHeading() {
        const item  = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        const label = new St.Label({
            text: 'FocusGuard',
            style_class: 'focusguard-menu-heading',
            x_expand: true,
        });
        item.add_child(label);
        this.menu.addMenuItem(item);
        return label;
    }

    _addTimerRow(title) {
        const item = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        const box  = new St.BoxLayout({ x_expand: true });

        box.add_child(new St.Label({
            text: title,
            style_class: 'focusguard-row-title',
            x_expand: true,
        }));
        const val = new St.Label({
            text: '—',
            style_class: 'focusguard-row-value',
        });
        box.add_child(val);
        item.add_child(box);
        this.menu.addMenuItem(item);
        return val;
    }

    _connectSignals() {
        this._timerHandlers = [
            this._timer.connect('tick',          () => this.update()),
            this._timer.connect('phase-changed', () => this.update()),
            this._timer.connect('suspended',     () => this.update()),
            this._timer.connect('resumed',       () => this.update()),
        ];
        this._settingsHandler = this._settings.gio.connect('changed::indicator-mode', () => this.update());
        this._menuOpenHandler = this.menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                this._refreshMenu();
                this._startMenuUpdates();
            } else {
                this._stopMenuUpdates();
            }
        });
    }

    _startMenuUpdates() {
        this._stopMenuUpdates();
        this._menuTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._refreshMenu();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopMenuUpdates() {
        if (this._menuTimeoutId) {
            GLib.source_remove(this._menuTimeoutId);
            this._menuTimeoutId = 0;
        }
    }

    update() {
        if (this._settings.indicatorMode === 'hidden') {
            this.visible = false;
            return;
        }
        this.visible = true;

        if (this.menu.isOpen)
            this._refreshMenu();
    }

    _refreshMenu() {
        const state     = this._timer.state;
        const remaining = this._timer.remaining;
        const inWork    = state === TimerState.WORK || state === TimerState.SUSPENDED;
        const inBreak   = state === TimerState.BREAK || state === TimerState.LONG_BREAK;
        const running   = this._timer.isRunning;

        // ── State heading ─────────────────────────────────────────────────
        this._stateHeading.text = STATE_HEADING[state] ?? 'FocusGuard';

        // ── Cycle info line ───────────────────────────────────────────────
        {
            const focusMins = Math.round(this._settings.workDuration / 60);
            const breakMins = Math.round(this._settings.breakDuration / 60);
            const focusStr  = focusMins >= 60
                ? `${Math.floor(focusMins / 60)}h${focusMins % 60 ? ` ${focusMins % 60}m` : ''}`
                : `${focusMins}m`;
            const breakStr  = breakMins >= 60
                ? `${Math.floor(breakMins / 60)}h${breakMins % 60 ? ` ${breakMins % 60}m` : ''}`
                : `${breakMins}m`;
            const autoLoop  = this._settings.autoStartBreaks && this._settings.autoStartWork;
            const repeat    = autoLoop ? ' · auto-repeating' : '';
            this._cycleInfo.text = `${focusStr} focus → ${breakStr} break${repeat}`;
        }

        // ── Focus Goal ───────────────────────────────────────────────────
        const goal = this._settings.currentFocusGoal || 'None';
        this._focusGoalValue.text = goal;

        // ── Live timers ───────────────────────────────────────────────────
        this._focusSessionValue.text =
            state !== TimerState.IDLE
                ? formatHMS(this._timer.sessionElapsed)
                : '00:00:00';

        if (inWork)
            this._nextBreakValue.text = formatHMS(remaining);
        else if (inBreak)
            this._nextBreakValue.text = formatHMS(remaining);
        else
            this._nextBreakValue.text = '00:00:00';

        this._eyeReminderValue.text = (state === TimerState.WORK)
            ? formatHMS(this._timer.eyeReminderRemaining)
            : '00:00:00';

        const hydroSec = this._timer.hydrationReminderRemaining;
        this._hydrationValue.text = hydroSec > 0
            ? formatHMS(hydroSec)
            : (this._settings.waterReminderEnabled ? '00:00:00' : '—');

        // ── Daily stats ───────────────────────────────────────────────────
        const today = this._analytics.getToday();
        this._todayFocusValue.text   = formatHMS(today.focus);

        const focusScore = this._analytics.getTodayFocusScore();
        this._focusScoreValue.text = `${focusScore}/100`;
        if (focusScore >= 80) {
            this._focusScoreValue.style = 'color: #8ae234; font-weight: bold;';
        } else if (focusScore >= 50) {
            this._focusScoreValue.style = 'color: #fce94f; font-weight: bold;';
        } else {
            this._focusScoreValue.style = 'color: #ef2929; font-weight: bold;';
        }

        const burnout = this._analytics.getTodayBurnoutAndRecovery();
        this._burnoutRiskValue.text = burnout.risk;
        if (burnout.risk === 'Low') {
            this._burnoutRiskValue.style = 'color: #8ae234; font-weight: bold;';
        } else if (burnout.risk === 'Moderate') {
            this._burnoutRiskValue.style = 'color: #fce94f; font-weight: bold;';
        } else {
            this._burnoutRiskValue.style = 'color: #ef2929; font-weight: bold;';
        }

        this._recoveryScoreValue.text = `${burnout.score}/100`;
        if (burnout.score >= 75) {
            this._recoveryScoreValue.style = 'color: #8ae234; font-weight: bold;';
        } else if (burnout.score >= 45) {
            this._recoveryScoreValue.style = 'color: #fce94f; font-weight: bold;';
        } else {
            this._recoveryScoreValue.style = 'color: #ef2929; font-weight: bold;';
        }

        this._waterConsumedValue.text = `${today.water} Glass${today.water !== 1 ? 'es' : ''}`;

        if (today.lastWaterLoggedTimestamp > 0) {
            const elapsedMin = Math.floor((Date.now() - today.lastWaterLoggedTimestamp) / 60000);
            this._lastWaterLoggedValue.text = elapsedMin === 0 ? 'Just now' : `${elapsedMin} minute${elapsedMin !== 1 ? 's' : ''} ago`;
        } else {
            this._lastWaterLoggedValue.text = 'Never';
        }

        this._eyeCompletedValue.text = `${today.eyeRemindersCompleted || 0}`;
        this._hydrationCompletedValue.text = `${today.hydrationRemindersCompleted || 0}`;

        // ── Action visibility ─────────────────────────────────────────────
        const idlePending = state === TimerState.SUSPENDED && this._timer.idlePendingResume;
        this._startItem.visible  = state === TimerState.IDLE;
        this._resumeItem.visible = state === TimerState.PAUSED || idlePending;
        this._pauseItem.visible  = (running || state === TimerState.SUSPENDED) && !idlePending;
        this._skipItem.visible   = (running || state === TimerState.SUSPENDED) && !idlePending;
        this._resetItem.visible  = state !== TimerState.IDLE;

        // ── Idea 3: progressive icon colour during focus ──────────────────
        const progress = this._timer.progress;
        const overdue  = state === TimerState.WORK && this._timer.remaining <= 0;
        const warning  = state === TimerState.WORK && progress >= 0.75 && !overdue;
        this._icon.remove_style_class_name('focusguard-panel-icon-warning');
        this._icon.remove_style_class_name('focusguard-panel-icon-overdue');
        if (overdue)        this._icon.add_style_class_name('focusguard-panel-icon-overdue');
        else if (warning)   this._icon.add_style_class_name('focusguard-panel-icon-warning');
    }

    refreshIfOpen() {
        if (this.menu.isOpen)
            this._refreshMenu();
    }

    destroy() {
        this._stopMenuUpdates();
        for (const id of this._timerHandlers ?? [])
            this._timer.disconnect(id);
        this._timerHandlers = null;
        if (this._settingsHandler) {
            this._settings.gio.disconnect(this._settingsHandler);
            this._settingsHandler = 0;
        }
        if (this._menuOpenHandler) {
            this.menu.disconnect(this._menuOpenHandler);
            this._menuOpenHandler = 0;
        }
        super.destroy();
    }
});
