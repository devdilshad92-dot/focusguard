/**
 * timerService.js — the unified FocusGuard state machine.
 *
 * Implements a single source of truth timer engine for all 4 timers:
 * 1. Focus Session (elapsed work-seconds, counts up)
 * 2. Break Timer (countdown to break end / next break)
 * 3. Eye Reminder (20-min rolling countdown for eye care)
 * 4. Hydration Reminder (periodic countdown for drinking water)
 *
 * It uses absolute system time to eliminate drift and runs a single heartbeat loop.
 */
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import { TimerState, TimerMode, TICK_INTERVAL_MS } from '../utils/constants.js';
import { clamp } from '../utils/helpers.js';
import { Logger } from '../utils/logger.js';

export const TimerService = GObject.registerClass({
    GTypeName: 'FocusGuardTimerService',
    Signals: {
        'tick': {},
        'phase-changed': { param_types: [GObject.TYPE_STRING] },
        'work-started': {},
        'break-due': { param_types: [GObject.TYPE_BOOLEAN] },
        'break-started': { param_types: [GObject.TYPE_BOOLEAN] },
        'break-finished': { param_types: [GObject.TYPE_BOOLEAN] },
        'eye-break-started': {},
        'eye-break-completed': {},
        'eye-break-skipped': {},
        'eye-break-finished': {},
        'hydration-due': {},
        'suspended': { param_types: [GObject.TYPE_STRING] },
        'resumed': {},
        'escalated': { param_types: [GObject.TYPE_INT] },
        'work-reset': {},
        'user-returned-from-idle': {},
    },
}, class TimerService extends GObject.Object {
    _init(settings, context) {
        super._init();
        this._settings = settings;
        this._ctx = context;

        this._state = TimerState.IDLE;
        this._resumeState = TimerState.WORK;
        this._suspendReason = null;
        this._remaining = 0;
        this._phaseTotal = 0;
        this._pomodoroCount = 0;
        this._escalationAccum = 0;
        this._breakDueEmitted = false;
        this._parked = false;
        this._workOverride = null;
        this._eyeRemaining = 0;
        this._sessionElapsed = 0;
        this._hydrationRemaining = Math.max(60, this._settings.waterReminderInterval * 60);

        this._tickId = 0;
        this._lastTickMs = 0;
        this._accumulatedTimeMs = 0;
        this._idlePendingResume = false;
    }

    setWorkOverride(seconds) {
        this._workOverride = seconds && seconds > 0 ? Math.round(seconds) : null;
    }

    get _effectiveWorkDuration() {
        return this._workOverride ?? this._settings.workDuration;
    }

    // ---- Public read-only state --------------------------------------------
    get state() { return this._state; }
    get suspendReason() { return this._suspendReason; }
    get remaining() { return this._remaining; }
    get phaseTotal() { return this._phaseTotal; }
    get pomodoroCount() { return this._pomodoroCount; }
    get isRunning() {
        return this._state === TimerState.WORK ||
            this._state === TimerState.BREAK ||
            this._state === TimerState.LONG_BREAK ||
            this._state === TimerState.EYE_BREAK;
    }

    get eyeReminderRemaining() { return this._eyeRemaining; }
    get hydrationReminderRemaining() { return this._hydrationRemaining; }
    get sessionElapsed() { return this._sessionElapsed; }

    get progress() {
        if (this._phaseTotal <= 0)
            return 0;
        return clamp(1 - this._remaining / this._phaseTotal, 0, 1);
    }

    get idlePendingResume() { return this._idlePendingResume; }

    // ---- Lifecycle ----------------------------------------------------------

    start() {
        this._pomodoroCount = 0;
        this._sessionElapsed = 0;
        this._idlePendingResume = false;
        this._beginWork();
    }

    togglePause() {
        if (this._state === TimerState.PAUSED)
            this.resume();
        else if (this.isRunning || this._state === TimerState.SUSPENDED)
            this.pause();
        else
            this.start();
    }

    pause() {
        if (this._state === TimerState.PAUSED || this._state === TimerState.IDLE)
            return;
        if (this._state !== TimerState.SUSPENDED)
            this._resumeState = this._state;
        this._idlePendingResume = false;
        this._setState(TimerState.PAUSED);
        this._stopTicking();
    }

    resume() {
        if (this._state !== TimerState.PAUSED)
            return;
        this._suspendReason = null;
        this._idlePendingResume = false;
        this._setState(this._resumeState);
        this._ensureTicking();
    }

    stop() {
        this._stopTicking();
        this._remaining = 0;
        this._phaseTotal = 0;
        this._suspendReason = null;
        this._parked = false;
        this._sessionElapsed = 0;
        this._eyeRemaining = 0;
        this._idlePendingResume = false;
        this._setState(TimerState.IDLE);
    }

    // ---- User actions on a pending/active break -----------------------------

    takeBreakNow() {
        if (this._state === TimerState.WORK || this._state === TimerState.IDLE)
            this._beginBreak();
    }

    skipBreak() {
        if (this._state === TimerState.BREAK || this._state === TimerState.LONG_BREAK)
            this._finishBreak(/* skipped */ true);
        else
            this._beginWork();
    }

    snooze(seconds) {
        this._escalationAccum = 0;
        this._breakDueEmitted = false;
        this._remaining = Math.max(1, seconds);
        if (this._state !== TimerState.WORK)
            this._setState(TimerState.WORK);
        this._phaseTotal = this._remaining;
        this._ensureTicking();
        this.emit('tick');
    }

    refreshFromSettings() {
        const maxInterval = Math.max(60, this._settings.waterReminderInterval * 60);
        if (this._hydrationRemaining > maxInterval) {
            this._hydrationRemaining = maxInterval;
        }
    }

    onUserActive() {
        if (this._parked) {
            this._parked = false;
            this._idlePendingResume = true;
            this._ensureTicking();
            this.emit('user-returned-from-idle');
        } else if (this._state === TimerState.SUSPENDED && this._suspendReason === 'idle') {
            this._idlePendingResume = true;
            this.emit('user-returned-from-idle');
        }
    }

    resumeFromIdle() {
        this._idlePendingResume = false;
        this._leaveSuspend();
    }

    dismissFromIdle() {
        this._idlePendingResume = false;
        this._suspendReason = null;
        this._setState(TimerState.PAUSED);
        this._stopTicking();
    }

    // ---- Eye Care Actions ----------------------------------------------------

    snoozeEyeBreak() {
        if (this._state === TimerState.EYE_BREAK) {
            this._eyeRemaining = 5 * 60; // 5 mins snooze
            this._remaining = this._remainingBeforeEyeBreak ?? 0;
            this._phaseTotal = this._phaseTotalBeforeEyeBreak ?? this._settings.workDuration;
            this._setState(TimerState.WORK);
            this.emit('eye-break-finished');
        }
    }

    skipEyeBreak() {
        if (this._state === TimerState.EYE_BREAK) {
            this._finishEyeBreak(true);
        }
    }

    resetHydrationTimer() {
        this._hydrationRemaining = Math.max(60, this._settings.waterReminderInterval * 60);
        this.emit('tick');
    }

    // ---- Internal phase transitions ----------------------------------------

    _wouldBeLong() {
        if (this._settings.timerMode !== TimerMode.POMODORO)
            return false;
        return (this._pomodoroCount + 1) % this._settings.pomodorosUntilLongBreak === 0;
    }

    _beginWork() {
        this._remaining = this._effectiveWorkDuration;
        this._phaseTotal = this._remaining;
        this._escalationAccum = 0;
        this._breakDueEmitted = false;
        this._suspendReason = null;
        this._parked = false;
        this._eyeRemaining = 20 * 60;
        this._setState(TimerState.WORK);
        this.emit('work-started');
        this._ensureTicking();
    }

    _beginBreak() {
        const isLong = this._wouldBeLong();
        this._breakDueEmitted = false;

        this._remaining = isLong
            ? this._settings.longBreakDuration
            : this._settings.breakDuration;
        this._phaseTotal = this._remaining;
        this._escalationAccum = 0;
        this._suspendReason = null;
        this._setState(isLong ? TimerState.LONG_BREAK : TimerState.BREAK);
        this.emit('break-started', isLong);
        this._ensureTicking();
    }

    _finishBreak(skipped = false) {
        const wasLong = this._state === TimerState.LONG_BREAK;
        this._pomodoroCount += 1;
        if (wasLong)
            this._pomodoroCount = 0;
        this.emit('break-finished', skipped);

        if (this._settings.autoStartWork)
            this._beginWork();
        else
            this.stop();
    }

    _triggerEyeBreak() {
        this._stateBeforeEyeBreak = this._state;
        this._remainingBeforeEyeBreak = this._remaining;
        this._phaseTotalBeforeEyeBreak = this._phaseTotal;
        this._setState(TimerState.EYE_BREAK);
        this._remaining = 20;
        this._phaseTotal = 20;
        this.emit('eye-break-started');
    }

    _finishEyeBreak(skipped = false) {
        if (skipped) {
            this.emit('eye-break-skipped');
        } else {
            this.emit('eye-break-completed');
        }
        this._eyeRemaining = 20 * 60;
        this._remaining = this._remainingBeforeEyeBreak ?? 0;
        this._phaseTotal = this._phaseTotalBeforeEyeBreak ?? this._settings.workDuration;
        this._setState(TimerState.WORK);
        this.emit('eye-break-finished');
    }

    // ---- Suspend / resume (automatic) --------------------------------------

    _enterSuspend(reason) {
        if (this._state === TimerState.SUSPENDED) {
            if (this._suspendReason !== reason) {
                this._suspendReason = reason;
                Logger.info(`Timer auto-pause reason changed: ${reason}`);
                this.emit('suspended', reason);
            }
            return;
        }
        this._resumeState = this._state;
        this._suspendReason = reason;
        Logger.info(`Timer auto-paused. Reason: ${reason}`);
        this._setState(TimerState.SUSPENDED);
        this.emit('suspended', reason);
    }

    _leaveSuspend() {
        if (this._state !== TimerState.SUSPENDED)
            return;
        this._suspendReason = null;
        this._setState(this._resumeState);
        this.emit('resumed');
    }

    // ---- Heartbeat & Ticking ------------------------------------------------

    _ensureTicking() {
        if (this._tickId)
            return;
        this._lastTickMs = Date.now();
        this._accumulatedTimeMs = 0;
        this._tickId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, TICK_INTERVAL_MS, () => this._onTick());
    }

    _stopTicking() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }

    _onTick() {
        if (!this._tickId)
            return GLib.SOURCE_REMOVE;
        try {
            const now = Date.now();
            const deltaMs = now - this._lastTickMs;
            this._lastTickMs = now;

            this._accumulatedTimeMs += deltaMs;
            const elapsedSec = Math.floor(this._accumulatedTimeMs / 1000);
            this._accumulatedTimeMs %= 1000;

            if (elapsedSec > 0) {
                const safeTicks = Math.min(elapsedSec, 86400);
                for (let i = 0; i < safeTicks; i++) {
                    this._tickOneSecond();
                }
                this.emit('tick');
            }
        } catch (e) {
            Logger.trace(e, 'timer tick');
        }
        return this._tickId ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
    }

    _tickOneSecond() {
        const blockReason = this._computeBlockReason();

        // --- Long-idle parking ---
        if (!this._parked && blockReason === 'idle' &&
            this._ctx.idleTimeMs() >= this._settings.idleResetThreshold * 1000) {
            if (this._state === TimerState.WORK || this._state === TimerState.SUSPENDED) {
                this._remaining = this._effectiveWorkDuration;
                this._phaseTotal = this._remaining;
                this.emit('work-reset');
            }
            this._enterSuspend('idle');
            this._parked = true;
            return;
        }

        if (this._idlePendingResume) {
            this._tickHydrationOneSecond();
            return;
        }

        if (blockReason) {
            this._enterSuspend(blockReason);
            this._tickHydrationOneSecond();
            return;
        }

        if (this._state === TimerState.SUSPENDED) {
            this._leaveSuspend();
        }

        // --- State Countdown ---
        if (this._state === TimerState.WORK) {
            if (this._remaining > 0) {
                this._remaining -= 1;
            }
            this._sessionElapsed += 1;

            if (this._settings.showEyeCare) {
                if (this._eyeRemaining > 0) {
                    this._eyeRemaining -= 1;
                    if (this._eyeRemaining <= 0) {
                        if (this._settings.deepWorkMode && this._detectIntenseWork()) {
                            // Deep work mode: do not interrupt. Keep at 0.
                        } else {
                            this._triggerEyeBreak();
                            return;
                        }
                    }
                } else if (this._eyeRemaining <= 0) {
                    if (!(this._settings.deepWorkMode && this._detectIntenseWork())) {
                        this._triggerEyeBreak();
                        return;
                    }
                }
            }

            if (this._remaining <= 0) {
                if (this._settings.deepWorkMode && this._detectIntenseWork()) {
                    // Deep work mode: do not interrupt work. Keep remaining at 0.
                } else if (this._settings.autoStartBreaks) {
                    this._beginBreak();
                    return;
                } else {
                    this._remaining = 0;
                    if (!this._breakDueEmitted) {
                        this._breakDueEmitted = true;
                        this.emit('break-due', this._wouldBeLong());
                    }
                    this._maybeEscalate();
                }
            }
        } else if (this._state === TimerState.BREAK || this._state === TimerState.LONG_BREAK) {
            if (this._remaining > 0) {
                this._remaining -= 1;
            }
            if (this._remaining <= 0) {
                this._finishBreak(false);
                return;
            }
        } else if (this._state === TimerState.EYE_BREAK) {
            if (this._remaining > 0) {
                this._remaining -= 1;
            }
            if (this._remaining <= 0) {
                this._finishEyeBreak(false);
                return;
            }
        }

        this._tickHydrationOneSecond();
    }

    _tickHydrationOneSecond() {
        if (this._settings.waterReminderEnabled) {
            if (this._hydrationRemaining > 0) {
                this._hydrationRemaining -= 1;
            }
            if (this._hydrationRemaining <= 0) {
                if (this._settings.deepWorkMode && this._detectIntenseWork()) {
                    // Deep work mode: do not interrupt. Keep at 0.
                } else {
                    this.emit('hydration-due');
                    this._hydrationRemaining = Math.max(60, this._settings.waterReminderInterval * 60);
                }
            }
        }
    }

    _computeBlockReason() {
        if (this._settings.pauseOnIdle && this._ctx.isIdle()) {
            if (this._state === TimerState.WORK || (this._state === TimerState.SUSPENDED && this._resumeState === TimerState.WORK)) {
                return 'idle';
            }
        }
        if (this._state === TimerState.WORK || this._state === TimerState.SUSPENDED) {
            const decision = this._ctx.getPostpone();
            if (decision.postpone)
                return decision.reason;
        }
        return null;
    }

    _detectIntenseWork() {
        try {
            const win = global.display.focus_window;
            if (!win)
                return false;
            const wmClass = (win.get_wm_class() || '').toLowerCase();
            const isWorkApp = ['code', 'cursor', 'terminal', 'gnome-terminal', 'ptyxis', 'kgx', 'alacritty', 'kitty', 'idea', 'jetbrains', 'pycharm', 'webstorm', 'clion', 'rider', 'goland', 'phpstorm', 'rubymine', 'studio', 'android-studio'].some(app => wmClass.includes(app));
            const idleTimeMs = this._ctx.idleTimeMs();
            return isWorkApp && (idleTimeMs < 15000);
        } catch (e) {
            Logger.debug('Failed to check deep work focus window:', e.message);
            return false;
        }
    }

    _maybeEscalate() {
        if (!this._settings.escalateIgnored)
            return;
        if (this._remaining > 0)
            return;
        this._escalationAccum += 1;
        if (this._escalationAccum >= this._settings.escalationInterval) {
            this._escalationAccum = 0;
            this.emit('escalated', 1);
        }
    }

    _setState(state) {
        if (this._state === state)
            return;
        this._state = state;
        this.emit('phase-changed', state);
    }

    destroy() {
        this._stopTicking();
        this._settings = null;
        this._ctx = null;
    }
});
