/**
 * healthPage.js — daily wellness goals.
 */
import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import { Keys } from '../../utils/constants.js';
import { minutesRow, spinRow, switchRow, group } from './widgets.js';

export function buildHealthPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Goals',
        icon_name: 'emblem-favorite-symbolic',
    });

    const goals = group(page, 'Daily Goals',
        'Targets that drive the progress shown in the menu and analytics.');

    minutesRow(goals, settings, Keys.DAILY_FOCUS_GOAL, 'Focus goal',
        { minMin: 30, maxMin: 960, subtitle: 'Total focused minutes per day' });
    spinRow(goals, settings, Keys.DAILY_BREAK_GOAL, 'Break goal',
        { min: 1, max: 48, subtitle: 'Breaks to take per day' });
    spinRow(goals, settings, Keys.DAILY_WATER_GOAL, 'Hydration goal',
        { min: 1, max: 30, subtitle: 'Glasses of water per day' });

    const hydration = group(page, 'Hydration Reminders',
        'Periodic nudges to drink water until the daily goal is met. ' +
        'Stay silent while you are idle, in deep work, or presenting.');

    const enabled = switchRow(hydration, settings, Keys.WATER_REMINDER_ENABLED,
        'Remind me to drink water', 'Send a notification on a fixed interval');
    const interval = spinRow(hydration, settings, Keys.WATER_REMINDER_INTERVAL,
        'Reminder interval',
        { min: 10, max: 480, step: 5, subtitle: 'Minutes between reminders' });

    // The interval only matters when reminders are on.
    enabled.bind_property('active', interval, 'sensitive',
        GObject.BindingFlags.SYNC_CREATE);

    return page;
}
