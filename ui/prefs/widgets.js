/**
 * widgets.js — Adwaita row factories for the preferences window.
 *
 * These keep prefs pages declarative and consistent, and centralise the
 * GSettings bindings so every page reads the same way. All helpers run in the
 * preferences process (GTK/Adw), never in the shell.
 */
import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

/** A boolean toggle bound directly to a settings key. */
export function switchRow(group, settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({ title, subtitle });
    group.add(row);
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

/** An integer spin row bound directly (raw units). */
export function spinRow(group, settings, key, title, { min, max, step = 1, subtitle = '' }) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({
            lower: min, upper: max, step_increment: step, page_increment: step * 5,
        }),
    });
    group.add(row);
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

/**
 * A spin row that edits a *seconds* key but displays *minutes*. Keeps the two
 * representations in sync without fighting each other (guards re-entrancy).
 */
export function minutesRow(group, settings, key, title, { minMin, maxMin, subtitle = '' }) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({
            lower: minMin, upper: maxMin, step_increment: 1, page_increment: 5,
        }),
    });
    group.add(row);

    let syncing = false;
    const load = () => {
        if (syncing) return;
        syncing = true;
        row.value = Math.round(settings.get_int(key) / 60);
        syncing = false;
    };
    load();
    const changedId = settings.connect(`changed::${key}`, load);
    row.connect('notify::value', () => {
        if (syncing) return;
        syncing = true;
        settings.set_int(key, Math.round(row.value) * 60);
        syncing = false;
    });
    row.connect('destroy', () => settings.disconnect(changedId));
    return row;
}

export function hoursMinutesRow(group, settings, key, title, { minMin = 1, maxMin, subtitle = '' }) {
    const row = new Adw.ActionRow({ title, subtitle });

    const maxHours = Math.floor(maxMin / 60);
    const hoursAdj = new Gtk.Adjustment({ lower: 0, upper: maxHours, step_increment: 1 });
    const minsAdj  = new Gtk.Adjustment({ lower: 0, upper: 59,       step_increment: 5 });

    const hoursSpin = new Gtk.SpinButton({ adjustment: hoursAdj, width_chars: 2, valign: Gtk.Align.CENTER });
    const minsSpin  = new Gtk.SpinButton({ adjustment: minsAdj,  width_chars: 2, valign: Gtk.Align.CENTER });

    row.add_suffix(hoursSpin);
    row.add_suffix(new Gtk.Label({ label: 'h', valign: Gtk.Align.CENTER, margin_end: 8 }));
    row.add_suffix(minsSpin);
    row.add_suffix(new Gtk.Label({ label: 'min', valign: Gtk.Align.CENTER }));
    row.activatable_widget = hoursSpin;
    group.add(row);

    let syncing = false;
    const load = () => {
        if (syncing) return;
        syncing = true;
        const totalMin = Math.round(settings.get_int(key) / 60);
        hoursSpin.value = Math.floor(totalMin / 60);
        minsSpin.value  = totalMin % 60;
        syncing = false;
    };
    load();
    const changedId = settings.connect(`changed::${key}`, load);

    const save = () => {
        if (syncing) return;
        syncing = true;
        const totalMin = Math.max(minMin, hoursSpin.value * 60 + minsSpin.value);
        settings.set_int(key, Math.min(maxMin, totalMin) * 60);
        syncing = false;
    };
    hoursSpin.connect('notify::value', save);
    minsSpin.connect('notify::value', save);
    row.connect('destroy', () => settings.disconnect(changedId));
    return row;
}

/**
 * A combo row backed by an enum/string key.
 * @param {Array<{id:string,label:string}>} options
 */
export function comboRow(group, settings, key, title, options, subtitle = '') {
    const model = new Gtk.StringList();
    for (const opt of options)
        model.append(opt.label);

    const row = new Adw.ComboRow({ title, subtitle, model });
    group.add(row);

    const ids = options.map(o => o.id);
    const syncFromSettings = () => {
        const current = settings.get_string(key);
        const idx = ids.indexOf(current);
        if (idx >= 0 && idx !== row.selected)
            row.selected = idx;
    };
    syncFromSettings();
    const changedId = settings.connect(`changed::${key}`, syncFromSettings);
    row.connect('notify::selected', () => {
        const id = ids[row.selected];
        if (id && id !== settings.get_string(key))
            settings.set_string(key, id);
    });
    row.connect('destroy', () => settings.disconnect(changedId));
    return row;
}

/**
 * A combo row backed by an integer key.
 * @param {Array<{value:number,label:string}>} options
 */
export function comboRowInt(group, settings, key, title, options, subtitle = '') {
    const model = new Gtk.StringList();
    for (const opt of options)
        model.append(opt.label);

    const row = new Adw.ComboRow({ title, subtitle, model });
    group.add(row);

    const values = options.map(o => o.value);
    const syncFromSettings = () => {
        const current = settings.get_int(key);
        const idx = values.indexOf(current);
        if (idx >= 0 && idx !== row.selected)
            row.selected = idx;
    };
    syncFromSettings();
    const changedId = settings.connect(`changed::${key}`, syncFromSettings);
    row.connect('notify::selected', () => {
        const val = values[row.selected];
        if (val !== undefined && val !== settings.get_int(key))
            settings.set_int(key, val);
    });
    row.connect('destroy', () => settings.disconnect(changedId));
    return row;
}

/** A free-text entry row bound to a string key. */
export function entryRow(group, settings, key, title) {
    const row = new Adw.EntryRow({ title });
    group.add(row);
    settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

/** A simple action row with a trailing button. */
export function buttonRow(group, title, subtitle, buttonLabel, onClick, { destructive = false } = {}) {
    const row = new Adw.ActionRow({ title, subtitle });
    const button = new Gtk.Button({
        label: buttonLabel,
        valign: Gtk.Align.CENTER,
    });
    if (destructive)
        button.add_css_class('destructive-action');
    button.connect('clicked', onClick);
    row.add_suffix(button);
    row.activatable_widget = button;
    group.add(row);
    return row;
}

/** A read-only informational row (title + value on the right). */
export function infoRow(group, title, value) {
    const row = new Adw.ActionRow({ title });
    const label = new Gtk.Label({
        label: String(value),
        css_classes: ['dim-label'],
        valign: Gtk.Align.CENTER,
    });
    row.add_suffix(label);
    group.add(row);
    return { row, label };
}

/** Convenience: a titled group added to a page. */
export function group(page, title, description = '') {
    const g = new Adw.PreferencesGroup({ title, description });
    page.add(g);
    return g;
}

/**
 * A lightweight horizontal bar-chart row, drawn with Gtk.DrawingArea.
 * @param {Array<{label:string, value:number}>} data
 */
export const BarChart = GObject.registerClass({
    GTypeName: 'FocusGuardBarChart',
}, class BarChart extends Gtk.DrawingArea {
    _init(data, { height = 160, accent = [0.2, 0.55, 0.95] } = {}) {
        super._init({
            height_request: height,
            hexpand: true,
            margin_top: 8,
            margin_bottom: 8,
        });
        this._data = data;
        this._accent = accent;
        this.set_draw_func((area, cr, width, h) => this._draw(cr, width, h));
    }

    setData(data) {
        this._data = data;
        this.queue_draw();
    }

    _draw(cr, width, height) {
        const data = this._data ?? [];
        if (!data.length)
            return;
        const max = Math.max(1, ...data.map(d => d.value));
        const n = data.length;
        const gap = 10;
        const labelH = 18;
        const barAreaH = height - labelH;
        const barW = (width - gap * (n + 1)) / n;
        const [r, g, b] = this._accent;

        for (let i = 0; i < n; i++) {
            const value = data[i].value;
            const barH = Math.max(2, (value / max) * (barAreaH - 8));
            const x = gap + i * (barW + gap);
            const y = barAreaH - barH;

            cr.setSourceRGBA(r, g, b, 0.9);
            _roundedRect(cr, x, y, barW, barH, 6);
            cr.fill();

            // x-axis label
            cr.setSourceRGBA(0.6, 0.6, 0.6, 1);
            cr.moveTo(x, height - 4);
            cr.showText(data[i].label);
        }
    }
});

function _roundedRect(cr, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    cr.newSubPath();
    cr.arc(x + w - radius, y + radius, radius, -Math.PI / 2, 0);
    cr.arc(x + w - radius, y + h - radius, radius, 0, Math.PI / 2);
    cr.arc(x + radius, y + h - radius, radius, Math.PI / 2, Math.PI);
    cr.arc(x + radius, y + radius, radius, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}
