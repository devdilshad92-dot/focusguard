/**
 * breakPage.js — the break experience (overlay + wellness content).
 */
import Adw from 'gi://Adw';
import { Keys } from '../../utils/constants.js';
import { spinRow, switchRow, group } from './widgets.js';

export function buildBreakPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Break',
        icon_name: 'face-smile-symbolic',
    });

    const overlay = group(page, 'Overlay');
    switchRow(overlay, settings, Keys.ALLOW_SKIP_BREAK,
        'Allow skipping the break', 'Show a Skip button and honour Esc.');
    spinRow(overlay, settings, Keys.OVERLAY_FADE_MS,
        'Fade animation (ms)', { min: 0, max: 2000, step: 50 });

    const content = group(page, 'Wellness Content',
        'Pick what to show during breaks.');
    switchRow(content, settings, Keys.SHOW_EYE_CARE,
        'Eye-care (20-20-20 rule)');
    switchRow(content, settings, Keys.SHOW_STRETCH_TIPS, 'Stretching suggestions');
    switchRow(content, settings, Keys.SHOW_POSTURE, 'Posture reminders');
    switchRow(content, settings, Keys.SHOW_HYDRATION, 'Hydration reminders');
    switchRow(content, settings, Keys.SHOW_BREATHING,
        'Guided breathing', 'Animated box-breathing during breaks.');

    return page;
}
