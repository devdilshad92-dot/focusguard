/**
 * developerPage.js — deep work, screen-share pausing and git streaks.
 */
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { Keys } from '../../utils/constants.js';
import { switchRow, entryRow, group } from './widgets.js';

export function buildDeveloperPage(settings, window) {
    const page = new Adw.PreferencesPage({
        title: 'Developer',
        icon_name: 'applications-engineering-symbolic',
    });

    const focus = group(page, 'Focus');
    switchRow(focus, settings, Keys.DEEP_WORK_MODE,
        'Deep work mode', 'Suppress all reminders until turned off.');
    switchRow(focus, settings, Keys.PAUSE_ON_SCREEN_SHARE,
        'Pause while screen sharing',
        'Detected via active idle-inhibitors during calls.');

    const git = group(page, 'Git Commit Streak',
        'Show today’s commits and your streak in the menu.');
    switchRow(git, settings, Keys.GIT_STREAK_ENABLED, 'Enable git streak');

    // A folder chooser for the repository path.
    const pathRow = entryRow(git, settings, Keys.GIT_REPO_PATH, 'Repository path');
    const browse = new Gtk.Button({
        icon_name: 'folder-open-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Choose a repository folder',
    });
    browse.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({ title: 'Select git repository' });
        dialog.select_folder(window, null, (dlg, res) => {
            try {
                const folder = dlg.select_folder_finish(res);
                if (folder)
                    settings.set_string(Keys.GIT_REPO_PATH, folder.get_path());
            } catch (e) {
                if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                    logError(e, 'git folder pick');
            }
        });
    });
    pathRow.add_suffix(browse);

    return page;
}
