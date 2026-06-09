/**
 * generalPage.js — appearance and indicator behaviour.
 */
import Adw from 'gi://Adw';
import { Keys } from '../../utils/constants.js';
import { comboRow, group } from './widgets.js';

export function buildGeneralPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'General',
        icon_name: 'preferences-system-symbolic',
    });

    const indicator = group(page, 'Panel Indicator',
        'How FocusGuard appears in the top bar.');

    comboRow(indicator, settings, Keys.INDICATOR_MODE, 'Display', [
        { id: 'icon-and-countdown', label: 'Icon and countdown' },
        { id: 'icon-only', label: 'Icon only' },
        { id: 'countdown-only', label: 'Countdown only' },
        { id: 'hidden', label: 'Hidden' },
    ]);

    comboRow(indicator, settings, Keys.INDICATOR_POSITION, 'Position', [
        { id: 'left', label: 'Left' },
        { id: 'center', label: 'Center' },
        { id: 'right', label: 'Right' },
    ], 'Takes effect after the extension is reloaded.');

    return page;
}
