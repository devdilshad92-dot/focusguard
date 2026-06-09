/**
 * backupPage.js — import / export / reset of settings.
 */
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { SettingsManager } from '../../services/settingsManager.js';
import { buttonRow, group } from './widgets.js';

export function buildBackupPage(settings, window) {
    const page = new Adw.PreferencesPage({
        title: 'Backup',
        icon_name: 'document-save-symbolic',
    });
    const sm = new SettingsManager(settings);

    const toast = msg => {
        // Adw.PreferencesWindow exposes add_toast() in recent libadwaita.
        try {
            window.add_toast?.(new Adw.Toast({ title: msg, timeout: 3 }));
        } catch { /* ignore — non-fatal UI nicety */ }
    };

    const io = group(page, 'Settings File',
        'Move your configuration between machines.');

    buttonRow(io, 'Export settings',
        'Save all preferences to a JSON file.', 'Export', () => {
            const dialog = new Gtk.FileDialog({
                title: 'Export FocusGuard settings',
                initial_name: 'focusguard-settings.json',
            });
            dialog.save(window, null, (dlg, res) => {
                try {
                    const file = dlg.save_finish(res);
                    if (!file)
                        return;
                    const json = JSON.stringify(sm.exportToObject(), null, 2);
                    file.replace_contents(
                        new TextEncoder().encode(json), null, false,
                        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                    toast('Settings exported');
                } catch (e) {
                    if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                        toast(`Export failed: ${e.message}`);
                }
            });
        });

    buttonRow(io, 'Import settings',
        'Load preferences from a JSON file.', 'Import', () => {
            const filter = new Gtk.FileFilter({ name: 'JSON' });
            filter.add_mime_type('application/json');
            filter.add_suffix('json');
            const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
            filters.append(filter);

            const dialog = new Gtk.FileDialog({
                title: 'Import FocusGuard settings',
                filters,
            });
            dialog.open(window, null, (dlg, res) => {
                try {
                    const file = dlg.open_finish(res);
                    if (!file)
                        return;
                    const [ok, contents] = file.load_contents(null);
                    if (!ok)
                        throw new Error('could not read file');
                    const obj = JSON.parse(new TextDecoder().decode(contents));
                    const { applied, skipped } = sm.importFromObject(obj);
                    toast(`Imported ${applied} settings (${skipped} skipped)`);
                } catch (e) {
                    if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                        toast(`Import failed: ${e.message}`);
                }
            });
        });

    const danger = group(page, 'Reset');
    buttonRow(danger, 'Restore defaults',
        'Reset every preference to its default value.', 'Reset', () => {
            const dialog = new Adw.AlertDialog({
                heading: 'Restore default settings?',
                body: 'Your analytics are kept. Preferences cannot be recovered.',
            });
            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('reset', 'Reset');
            dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.connect('response', (_d, response) => {
                if (response === 'reset') {
                    sm.resetAll();
                    toast('Settings restored to defaults');
                }
            });
            dialog.present(window);
        }, { destructive: true });

    window.connect('close-request', () => sm.destroy());
    return page;
}
