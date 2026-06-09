/**
 * dialogs.js — custom modal dialogs for FocusGuard.
 *
 * Implements native GNOME Shell dialogs using the standard ModalDialog module.
 */
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

export const ResetWaterDialog = GObject.registerClass({
    GTypeName: 'FocusGuardResetWaterDialog',
}, class ResetWaterDialog extends ModalDialog.ModalDialog {
    _init(callback) {
        super._init({ styleClass: 'focusguard-dialog' });
        this._callback = callback;

        const title = new St.Label({
            text: 'Reset Water Counter',
            style_class: 'focusguard-dialog-title',
        });
        this.contentLayout.add_child(title);

        const label = new St.Label({
            text: 'Reset today\'s water intake?',
            style_class: 'focusguard-dialog-text',
        });
        this.contentLayout.add_child(label);

        this.addButton({
            label: 'Yes, reset',
            action: () => {
                this._callback();
                this.close();
            },
            key: Clutter.KEY_Return,
        });

        this.addButton({
            label: 'Cancel',
            action: () => this.close(),
            key: Clutter.KEY_Escape,
        });
    }
});

export const GoalDialog = GObject.registerClass({
    GTypeName: 'FocusGuardGoalDialog',
}, class GoalDialog extends ModalDialog.ModalDialog {
    _init(callback) {
        super._init({ styleClass: 'focusguard-dialog' });
        this._callback = callback;

        const title = new St.Label({
            text: 'What are you working on today?',
            style_class: 'focusguard-dialog-title',
        });
        this.contentLayout.add_child(title);

        this._entry = new St.Entry({
            hint_text: 'e.g., Fix pricing API, Build FocusGuard',
            style_class: 'focusguard-dialog-entry',
            can_focus: true,
        });
        this.contentLayout.add_child(this._entry);

        this.addButton({
            label: 'Set Goal',
            action: () => {
                this._callback(this._entry.get_text());
                this.close();
            },
            key: Clutter.KEY_Return,
        });

        this.addButton({
            label: 'Cancel',
            action: () => this.close(),
            key: Clutter.KEY_Escape,
        });
    }

    open() {
        const success = super.open();
        if (success) {
            this._entry.grab_key_focus();
        }
        return success;
    }
});

export const WeeklyReportDialog = GObject.registerClass({
    GTypeName: 'FocusGuardWeeklyReportDialog',
}, class WeeklyReportDialog extends ModalDialog.ModalDialog {
    _init(stats) {
        super._init({ styleClass: 'focusguard-dialog weekly-report-dialog' });

        const title = new St.Label({
            text: 'Weekly Productivity Report',
            style_class: 'focusguard-dialog-title',
        });
        this.contentLayout.add_child(title);

        const grid = new St.BoxLayout({
            vertical: true,
            style_class: 'focusguard-dialog-grid',
        });
        this.contentLayout.add_child(grid);

        const addRow = (label, val, valColor = '') => {
            const row = new St.BoxLayout({ style_class: 'focusguard-dialog-row' });
            row.add_child(new St.Label({
                text: label,
                style_class: 'focusguard-dialog-row-label',
                x_expand: true,
            }));
            const vLabel = new St.Label({
                text: val,
                style_class: 'focusguard-dialog-row-value',
            });
            if (valColor) {
                vLabel.style = `color: ${valColor}; font-weight: bold;`;
            }
            row.add_child(vLabel);
            grid.add_child(row);
        };

        addRow('Total Focus Time', stats.totalFocus);
        addRow('Average Focus Score', stats.avgFocusScore, '#8ae234');
        addRow('Average Recovery Score', stats.avgRecoveryScore, '#729fcf');
        addRow('Break Compliance', stats.breakCompliance);
        addRow('Eye Care Compliance', stats.eyeCareCompliance);
        addRow('Water Intake', stats.waterIntake);
        addRow('Most Productive Day', stats.mostProductiveDay);
        addRow('Longest Focus Session', stats.longestFocusSession);

        this.addButton({
            label: 'Close',
            action: () => this.close(),
            key: Clutter.KEY_Escape,
        });
    }
});
