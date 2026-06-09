/**
 * timerPage.js — focus / break durations and Pomodoro cycles.
 */
import Adw from 'gi://Adw';
import { Keys } from '../../utils/constants.js';
import { comboRow, hoursMinutesRow, spinRow, switchRow, group } from './widgets.js';

export function buildTimerPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Timer',
        icon_name: 'alarm-symbolic',
    });

    const mode = group(page, 'Mode');
    comboRow(mode, settings, Keys.TIMER_MODE, 'Timer mode', [
        { id: 'simple', label: 'Simple interval' },
        { id: 'pomodoro', label: 'Pomodoro' },
    ], 'Simple repeats one focus/break cycle. Pomodoro adds long breaks.');

    const durations = group(page, 'Durations');
    hoursMinutesRow(durations, settings, Keys.WORK_DURATION, 'Focus block',
        { minMin: 1, maxMin: 240, subtitle: 'Focus time before a break' });
    hoursMinutesRow(durations, settings, Keys.BREAK_DURATION, 'Short break',
        { minMin: 1, maxMin: 60 });
    hoursMinutesRow(durations, settings, Keys.LONG_BREAK_DURATION, 'Long break',
        { minMin: 1, maxMin: 120, subtitle: 'Pomodoro mode only' });
    spinRow(durations, settings, Keys.POMODOROS_UNTIL_LONG_BREAK,
        'Focus blocks per long break', { min: 2, max: 12 });

    const flow = group(page, 'Automation');
    switchRow(flow, settings, Keys.AUTO_START_BREAKS,
        'Start breaks automatically',
        'Otherwise FocusGuard asks first when a break is due.');
    switchRow(flow, settings, Keys.AUTO_START_WORK,
        'Start the next focus block automatically');

    const adaptive = group(page, 'Adaptive Scheduling');
    switchRow(adaptive, settings, Keys.ADAPTIVE_SCHEDULING,
        'Adapt focus length to behaviour',
        'Gently shortens blocks when breaks are skipped, lengthens them when compliance is high.');

    const smart = group(page, 'Smart Break Timing');
    switchRow(smart, settings, Keys.ACTIVE_WORK_ONLY,
        'Count active work time only',
        'Pause the focus countdown when keyboard/mouse is idle for 10 seconds.');
    spinRow(smart, settings, Keys.NATURAL_PAUSE_THRESHOLD,
        'Natural pause before break (seconds)',
        { min: 1, max: 30, step: 1,
          subtitle: 'Wait for a typing gap before showing the break reminder.' });

    return page;
}
