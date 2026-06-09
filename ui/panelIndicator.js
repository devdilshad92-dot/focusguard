/**
 * panelIndicator.js — top-bar icon and dropdown dashboard.
 *
 * Panel: a single static blue icon. No text, no counters.
 * Clicking it opens the dropdown — nothing else happens.
 *
 * Dropdown: a live dashboard with HH:MM:SS timers updating every second.
 *
 *   [State heading]
 *   Focus Session       02:17:43  ← session elapsed (counts up)
 *   Next Break          00:12:18  ← work remaining  (counts down)
 *   Eye Reminder        00:04:32  ← 20-min rolling  (counts down)
 *   Hydration Reminder  00:08:15  ← reminder interval (counts down)
 *   ───────────────────────────────
 *   Today's Focus       03:42:19
 *   Water Consumed      5 Glasses
 *   ───────────────────────────────
 *   ▶ Start Focus Session
 *   ⏸ Pause Timers
 *   ⏭ Skip Current Reminder
 *   💧 Add Glass of Water
 *   🔄 Reset Water Counter ▸
 *       ✓  Yes, reset today's water
 *       ✗  Cancel
 *   🔄 Reset Focus Session
 *   ───────────────────────────────
 *   ⚙  Settings
 */
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { TimerState } from '../utils/constants.js';
import { formatHMS, formatDurationLong } from '../utils/helpers.js';

const STATE_HEADING = {
    [TimerState.IDLE]:       'Ready to focus',
    [TimerState.WORK]:       'Focusing',
    [TimerState.BREAK]:      'On Break',
    [TimerState.LONG_BREAK]: 'Long Break',
    [TimerState.PAUSED]:     'Paused',
    [TimerState.SUSPENDED]:  'Auto-paused',
};

export const PanelIndicator = GObject.registerClass({
    GTypeName: 'FocusGuardPanelIndicator',
}, class PanelIndicator extends PanelMenu.Button {
    _init({ timer, settings, analytics, hydration, onOpenPrefs, onAddWater, onResetWater }) {
        super._init(0.0, 'FocusGuard', false);

        this._timer      = timer;
        this._settings   = settings;
        this._analytics  = analytics;
        this._hydration  = hydration;
        this._onOpenPrefs  = onOpenPrefs;
        this._onAddWater   = onAddWater;
        this._onResetWater = onResetWater;

        this._buildButton();
        this._buildMenu();
        this._connectSignals();
        this.update();
    }

    // ── Panel button: single blue icon, no text ──────────────────────────────

    _buildButton() {
        this._icon = new St.Icon({
            icon_name: 'focus-windows-symbolic',
            style_class: 'system-status-icon focusguard-panel-icon',
        });
        this.add_child(this._icon);
    }

    // ── Dropdown menu ────────────────────────────────────────────────────────

    _buildMenu() {
        // ── Live timer section ───────────────────────────────────────────
        this._stateHeading = this._addHeading();
        this._focusSessionValue    = this._addTimerRow('Focus Session');
        this._nextBreakValue       = this._addTimerRow('Next Break');
        this._eyeReminderValue     = this._addTimerRow('Eye Reminder');
        this._hydrationValue       = this._addTimerRow('Hydration Reminder');

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Daily stats section ──────────────────────────────────────────
        this._todayFocusValue  = this._addTimerRow("Today's Focus");
        this._waterConsumedValue = this._addTimerRow('Water Consumed');

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Actions ──────────────────────────────────────────────────────
        this._startItem = new PopupMenu.PopupMenuItem('▶  Start Focus Session');
        this._startItem.connect('activate', () => this._timer.start());
        this.menu.addMenuItem(this._startItem);

        this._resumeItem = new PopupMenu.PopupMenuItem('▶  Resume');
        this._resumeItem.connect('activate', () => this._timer.resume());
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

        // Reset water — with inline confirmation submenu
        const resetWaterSub = new PopupMenu.PopupSubMenuMenuItem('🔄  Reset Water Counter');
        const confirmWater = new PopupMenu.PopupMenuItem('✓  Yes, reset today\'s water');
        confirmWater.connect('activate', () => {
            this._onResetWater?.();
            resetWaterSub.menu.close();
        });
        const cancelWater = new PopupMenu.PopupMenuItem('✗  Cancel');
        cancelWater.connect('activate', () => resetWaterSub.menu.close());
        resetWaterSub.menu.addMenuItem(confirmWater);
        resetWaterSub.menu.addMenuItem(cancelWater);
        this.menu.addMenuItem(resetWaterSub);

        this._resetItem = new PopupMenu.PopupMenuItem('🔄  Reset Focus Session');
        this._resetItem.connect('activate', () => this._timer.stop());
        this.menu.addMenuItem(this._resetItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Settings ─────────────────────────────────────────────────────
        const prefsItem = new PopupMenu.PopupMenuItem('⚙  Settings');
        prefsItem.connect('activate', () => this._onOpenPrefs?.());
        this.menu.addMenuItem(prefsItem);
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

    /** Adds a two-column info row: title on left, live value on right. */
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

    // ── Signals ──────────────────────────────────────────────────────────────

    _connectSignals() {
        this._timerHandlers = [
            this._timer.connect('tick',          () => this.update()),
            this._timer.connect('phase-changed', () => this.update()),
            this._timer.connect('suspended',     () => this.update()),
            this._timer.connect('resumed',       () => this.update()),
        ];
        this._settings.connect('indicator-mode', () => this.update());
    }

    // ── Live update (called every tick) ─────────────────────────────────────

    update() {
        if (this._settings.indicatorMode === 'hidden') {
            this.visible = false;
            return;
        }
        this.visible = true;

        // Only update menu rows when the dropdown is actually open — there is
        // nothing else to update (the panel icon is static).
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

        // ── Live timers ───────────────────────────────────────────────────
        // Focus Session: work-seconds elapsed since start() — counts up.
        this._focusSessionValue.text =
            state !== TimerState.IDLE
                ? formatHMS(this._timer.sessionElapsed)
                : '00:00:00';

        // Next Break: work-block remaining (down) or break remaining (down).
        if (inWork)
            this._nextBreakValue.text = formatHMS(remaining);
        else if (inBreak)
            this._nextBreakValue.text = formatHMS(remaining); // break ends in…
        else
            this._nextBreakValue.text = '00:00:00';

        // Eye Reminder: 20-min rolling counter.
        this._eyeReminderValue.text = inWork
            ? formatHMS(this._timer.eyeReminderRemaining)
            : '00:00:00';

        // Hydration reminder: time until next scheduled nudge.
        const hydroSec = this._hydration?.remainingSeconds ?? 0;
        this._hydrationValue.text = hydroSec > 0
            ? formatHMS(hydroSec)
            : (this._settings.waterReminderEnabled ? '00:00:00' : '—');

        // ── Daily stats ───────────────────────────────────────────────────
        const today = this._analytics.getToday();
        this._todayFocusValue.text   = formatHMS(today.focus);
        this._waterConsumedValue.text = `${today.water} Glass${today.water !== 1 ? 'es' : ''}`;

        // ── Action visibility ─────────────────────────────────────────────
        this._startItem.visible  = state === TimerState.IDLE;
        this._resumeItem.visible = state === TimerState.PAUSED;
        this._pauseItem.visible  = running || state === TimerState.SUSPENDED;
        this._skipItem.visible   = running || state === TimerState.SUSPENDED;
        this._resetItem.visible  = state !== TimerState.IDLE;
    }

    /** Called externally after water is logged so the count refreshes live. */
    refreshIfOpen() {
        if (this.menu.isOpen)
            this._refreshMenu();
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    destroy() {
        for (const id of this._timerHandlers ?? [])
            this._timer.disconnect(id);
        this._timerHandlers = null;
        super.destroy();
    }
});
