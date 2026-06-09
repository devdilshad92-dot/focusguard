/**
 * remindersPage.js — how, when and how insistently reminders appear.
 */
import Adw from 'gi://Adw';
import { Keys } from '../../utils/constants.js';
import { comboRow, comboRowInt, spinRow, switchRow, group } from './widgets.js';

export function buildRemindersPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Reminders',
        icon_name: 'preferences-system-notifications-symbolic',
    });

    const style = group(page, 'Presentation');
    comboRow(style, settings, Keys.REMINDER_STYLE, 'Reminder style', [
        { id: 'notification', label: 'Notification' },
        { id: 'overlay', label: 'Fullscreen overlay' },
        { id: 'both', label: 'Notification + overlay' },
    ]);
    switchRow(style, settings, Keys.ENABLE_NOTIFICATIONS, 'Native notifications');
    switchRow(style, settings, Keys.ENABLE_SOUNDS, 'Play sounds');

    const idle = group(page, 'Idle Awareness',
        'FocusGuard never nags you while you are away.');
    switchRow(idle, settings, Keys.PAUSE_ON_IDLE, 'Pause when idle');
    comboRowInt(idle, settings, Keys.IDLE_THRESHOLD, 'Idle threshold', [
        { value: 300, label: '5 minutes' },
        { value: 600, label: '10 minutes (default)' },
        { value: 900, label: '15 minutes' },
        { value: 1200, label: '20 minutes' },
        { value: 1800, label: '30 minutes' },
    ]);
    spinRow(idle, settings, Keys.IDLE_RESET_THRESHOLD,
        'Reset focus after idle (seconds)',
        { min: 60, max: 7200, step: 30,
          subtitle: 'A long absence counts as a natural break.' });

    const postpone = group(page, 'Smart Postponing');
    switchRow(postpone, settings, Keys.POSTPONE_ON_FULLSCREEN,
        'Postpone during fullscreen apps');
    switchRow(postpone, settings, Keys.POSTPONE_ON_INHIBIT,
        'Postpone during media playback & calls',
        'Honours system idle-inhibitors set by players and conferencing apps.');

    const escalation = group(page, 'Escalation');
    switchRow(escalation, settings, Keys.ESCALATE_IGNORED,
        'Escalate ignored breaks',
        'Send a stronger nudge if a due break keeps being postponed.');
    spinRow(escalation, settings, Keys.ESCALATION_INTERVAL,
        'Seconds between nudges', { min: 15, max: 600, step: 5 });

    return page;
}
