/**
 * prefs.js — FocusGuard preferences entry point.
 *
 * Runs in a separate GTK/libadwaita process (never in the shell). It assembles
 * the preference pages from ui/prefs/* and hands the window a single
 * Gio.Settings. Each page owns its own bindings and cleans them up on close.
 */
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { buildGeneralPage } from './ui/prefs/generalPage.js';
import { buildTimerPage } from './ui/prefs/timerPage.js';
import { buildRemindersPage } from './ui/prefs/remindersPage.js';
import { buildBreakPage } from './ui/prefs/breakPage.js';
import { buildHealthPage } from './ui/prefs/healthPage.js';
import { buildDeveloperPage } from './ui/prefs/developerPage.js';
import { buildAnalyticsPage } from './ui/prefs/analyticsPage.js';
import { buildBackupPage } from './ui/prefs/backupPage.js';

export default class FocusGuardPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.set_default_size(720, 720);
        window.search_enabled = true;

        window.add(buildGeneralPage(settings));
        window.add(buildTimerPage(settings));
        window.add(buildRemindersPage(settings));
        window.add(buildBreakPage(settings));
        window.add(buildHealthPage(settings));
        window.add(buildAnalyticsPage(settings, window));
        window.add(buildDeveloperPage(settings, window));
        window.add(buildBackupPage(settings, window));
    }
}
