/**
 * breakOverlay.js — the fullscreen break experience.
 *
 * Presents a calm, dimmed overlay with a live break countdown and rotating
 * wellness content (stretch, eye-care, hydration, posture) plus an optional
 * guided box-breathing animation. It handles both regular breaks and eye breaks.
 */
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    StretchTips, EyeCareTips, HydrationTips, PostureTips, WalkingTips,
    BreathingPattern,
} from '../utils/constants.js';
import { formatCountdown, sample } from '../utils/helpers.js';
import { Logger } from '../utils/logger.js';

export const BreakOverlay = GObject.registerClass({
    GTypeName: 'FocusGuardBreakOverlay',
    Signals: {
        'skip-requested': {},
    },
}, class BreakOverlay extends GObject.Object {
    _init({ settings, timer }) {
        super._init();
        this._settings = settings;
        this._timer = timer;
        this._actor = null;
        this._grab = null;
        this._breathId = 0;
        this._tipId = 0;
        this._tickHandler = 0;
        this._type = 'short';
    }

    get isShowing() {
        return this._actor !== null;
    }

    /** Show the overlay. type can be 'short', 'long', or 'eye' */
    show(type = 'short') {
        if (this._actor)
            return;

        this._type = type;
        const isEye = type === 'eye';

        const monitor = Main.layoutManager.primaryMonitor;
        this._actor = new St.Widget({
            style_class: 'focusguard-overlay',
            reactive: true,
            can_focus: true,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
            opacity: 0,
            layout_manager: new Clutter.BinLayout(),
        });

        const content = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'focusguard-overlay-content',
        });
        this._actor.add_child(content);

        // Heading.
        let headingText = 'Time for a break';
        if (type === 'long') {
            headingText = 'Time for a long break';
        } else if (isEye) {
            headingText = 'Look away from the screen';
        }

        content.add_child(new St.Label({
            text: headingText,
            style_class: 'focusguard-overlay-title',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        // Countdown.
        this._countdown = new St.Label({
            text: formatCountdown(this._timer.remaining),
            style_class: 'focusguard-overlay-countdown',
            x_align: Clutter.ActorAlign.CENTER,
        });
        content.add_child(this._countdown);

        // Breathing circle (optional).
        if (this._settings.showBreathing && !isEye) {
            this._breathCircle = new St.Widget({
                style_class: 'focusguard-breath-circle',
                width: 120,
                height: 120,
                x_align: Clutter.ActorAlign.CENTER,
            });
            this._breathCircle.set_pivot_point(0.5, 0.5);
            const breathWrap = new St.Bin({
                x_align: Clutter.ActorAlign.CENTER,
                child: this._breathCircle,
                style_class: 'focusguard-breath-wrap',
            });
            content.add_child(breathWrap);
            this._breathLabel = new St.Label({
                text: 'Breathe in…',
                style_class: 'focusguard-breath-label',
                x_align: Clutter.ActorAlign.CENTER,
            });
            content.add_child(this._breathLabel);
            this._startBreathing();
        }

        // Rotating wellness tip.
        this._tipLabel = new St.Label({
            text: this._pickTip(isEye),
            style_class: 'focusguard-overlay-tip',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._tipLabel.clutter_text.line_wrap = true;
        content.add_child(this._tipLabel);
        this._startTipRotation(isEye);

        // Actions.
        const buttons = new St.BoxLayout({
            style_class: 'focusguard-overlay-buttons',
            x_align: Clutter.ActorAlign.CENTER,
        });

        if (isEye) {
            const skip = new St.Button({
                label: 'Skip  (Esc)',
                style_class: 'focusguard-overlay-button',
                can_focus: true,
            });
            skip.connect('clicked', () => this._timer.skipEyeBreak());
            buttons.add_child(skip);

            const snooze = new St.Button({
                label: 'Snooze 5m',
                style_class: 'focusguard-overlay-button',
                can_focus: true,
            });
            snooze.connect('clicked', () => this._timer.snoozeEyeBreak());
            buttons.add_child(snooze);
        } else {
            if (this._settings.allowSkipBreak) {
                const skip = new St.Button({
                    label: 'Skip break  (Esc)',
                    style_class: 'focusguard-overlay-button',
                    can_focus: true,
                });
                skip.connect('clicked', () => this.emit('skip-requested'));
                buttons.add_child(skip);
            }
        }
        content.add_child(buttons);

        // Mount, grab and fade in.
        Main.layoutManager.addTopChrome(this._actor);
        this._grabKeyboard();

        this._tickHandler = this._timer.connect('tick', () => {
            if (this._countdown)
                this._countdown.text = formatCountdown(this._timer.remaining);
        });

        this._actor.ease({
            opacity: 255,
            duration: this._settings.overlayFadeMs,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    /** Fade out and destroy. */
    hide() {
        if (!this._actor)
            return;
        const actor = this._actor;
        this._actor = null;

        this._stopBreathing();
        this._stopTipRotation();
        this._releaseKeyboard();
        if (this._tickHandler) {
            this._timer.disconnect(this._tickHandler);
            this._tickHandler = 0;
        }

        actor.ease({
            opacity: 0,
            duration: this._settings.overlayFadeMs,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => actor.destroy(),
        });
    }

    // ---- Keyboard handling --------------------------------------------------

    _grabKeyboard() {
        try {
            this._grab = Main.pushModal(this._actor, { actionMode: 1 << 0 });
            this._actor.grab_key_focus();
        } catch (e) {
            Logger.debug('overlay modal grab failed:', e.message);
            this._grab = null;
        }
        this._keyHandler = this._actor.connect('key-press-event', (_a, event) => {
            const sym = event.get_key_symbol();
            if (sym === Clutter.KEY_Escape) {
                if (this._type === 'eye') {
                    this._timer.skipEyeBreak();
                    return Clutter.EVENT_STOP;
                } else if (this._settings.allowSkipBreak) {
                    this.emit('skip-requested');
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _releaseKeyboard() {
        if (this._keyHandler && this._actor) {
            this._actor.disconnect(this._keyHandler);
        }
        this._keyHandler = 0;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
    }

    // ---- Guided breathing ---------------------------------------------------

    _startBreathing() {
        const phases = [
            { label: 'Breathe in…', scale: 1.6, ms: BreathingPattern.inhale * 1000 },
            { label: 'Hold', scale: 1.6, ms: BreathingPattern.hold * 1000 },
            { label: 'Breathe out…', scale: 1.0, ms: BreathingPattern.exhale * 1000 },
            { label: 'Hold', scale: 1.0, ms: BreathingPattern.holdEmpty * 1000 },
        ];
        let i = 0;
        const step = () => {
            if (!this._breathCircle)
                return GLib.SOURCE_REMOVE;
            const phase = phases[i % phases.length];
            this._breathLabel.text = phase.label;
            this._breathCircle.ease({
                scale_x: phase.scale,
                scale_y: phase.scale,
                duration: phase.ms,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            });
            i += 1;
            this._breathId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT, phase.ms, step);
            return GLib.SOURCE_REMOVE;
        };
        step();
    }

    _stopBreathing() {
        if (this._breathId) {
            GLib.source_remove(this._breathId);
            this._breathId = 0;
        }
    }

    // ---- Rotating tips ------------------------------------------------------

    _pickTip(isEye = false) {
        if (isEye) {
            return sample(EyeCareTips);
        }
        const pools = [];
        if (this._settings.showEyeCare)
            pools.push(EyeCareTips);
        if (this._settings.showStretchTips)
            pools.push(StretchTips);
        if (this._settings.showHydration)
            pools.push(HydrationTips);
        if (this._settings.showPosture)
            pools.push(PostureTips);
        pools.push(WalkingTips);
        const pool = sample(pools) ?? StretchTips;
        return sample(pool);
    }

    _startTipRotation(isEye = false) {
        this._tipId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 12, () => {
            if (!this._tipLabel)
                return GLib.SOURCE_REMOVE;
            this._tipLabel.text = this._pickTip(isEye);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTipRotation() {
        if (this._tipId) {
            GLib.source_remove(this._tipId);
            this._tipId = 0;
        }
    }

    destroy() {
        this.hide();
        this._settings = null;
        this._timer = null;
    }
});
