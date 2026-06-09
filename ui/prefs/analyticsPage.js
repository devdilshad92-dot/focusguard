/**
 * analyticsPage.js — productivity dashboard.
 *
 * Reads the same analytics blob the shell writes (via a read-only
 * AnalyticsService bound to the prefs Gio.Settings) and renders a weekly focus
 * chart plus headline stats. Because prefs run in their own process we re-read
 * on `map` so the figures are fresh each time the page is shown.
 */
import Adw from 'gi://Adw';
import { AnalyticsService } from '../../services/analyticsService.js';
import { SettingsManager } from '../../services/settingsManager.js';
import { formatDurationLong } from '../../utils/helpers.js';
import { BarChart, infoRow, buttonRow, group } from './widgets.js';

export function buildAnalyticsPage(settings, window) {
    const page = new Adw.PreferencesPage({
        title: 'Analytics',
        icon_name: 'org.gnome.Settings-system-symbolic',
    });

    const sm = new SettingsManager(settings);
    const analytics = new AnalyticsService(sm);

    // --- Weekly chart ---
    const chartGroup = group(page, 'This Week',
        'Daily focused time over the last 7 days.');
    const chart = new BarChart([]);
    chartGroup.add(chart);

    // --- Headline figures ---
    const statsGroup = group(page, 'Summary');
    const todayFocus = infoRow(statsGroup, 'Focus today', '—');
    const weekFocus = infoRow(statsGroup, 'Focus this week', '—');
    const breaks = infoRow(statsGroup, 'Breaks taken (7d)', '—');
    const compliance = infoRow(statsGroup, 'Break compliance (7d)', '—');
    const streak = infoRow(statsGroup, 'Current focus streak', '—');
    const longest = infoRow(statsGroup, 'Longest focus streak', '—');

    const refresh = () => {
        const range = analytics.getRange(7);
        chart.setData(range.map(d => ({
            label: d.date.slice(5),                // MM-DD
            value: Math.round(d.focus / 60),       // minutes
        })));

        const goal = sm.dailyFocusGoal;
        const today = analytics.getToday();
        const weekSeconds = range.reduce((a, d) => a + d.focus, 0);
        const breaksTaken = range.reduce((a, d) => a + d.breaksTaken, 0);

        todayFocus.label.label = formatDurationLong(today.focus);
        weekFocus.label.label = formatDurationLong(weekSeconds);
        breaks.label.label = String(breaksTaken);
        compliance.label.label = `${Math.round(analytics.getComplianceRate(7) * 100)}%`;
        streak.label.label = `${analytics.getCurrentStreak(goal)} days`;
        longest.label.label = `${analytics.getLongestStreak(goal)} days`;
    };
    refresh();
    page.connect('map', refresh);

    // --- Maintenance ---
    const danger = group(page, 'Data');
    buttonRow(danger, 'Reset statistics',
        'Permanently delete all recorded analytics.',
        'Reset', () => {
            const dialog = new Adw.AlertDialog({
                heading: 'Reset all statistics?',
                body: 'This cannot be undone.',
            });
            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('reset', 'Reset');
            dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.connect('response', (_d, response) => {
                if (response === 'reset') {
                    analytics.reset();
                    refresh();
                }
            });
            dialog.present(window);
        }, { destructive: true });

    // Detach on close. We deliberately do NOT flush here: the prefs process
    // only ever reads (reset() flushes itself immediately), so flushing the
    // possibly-stale in-memory copy could clobber data the running shell wrote.
    window.connect('close-request', () => {
        sm.destroy();
    });

    return page;
}
