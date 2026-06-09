/**
 * healthPage.js — daily wellness goals.
 */
import Adw from 'gi://Adw';
import { Keys } from '../../utils/constants.js';
import { minutesRow, spinRow, group } from './widgets.js';

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

    return page;
}
