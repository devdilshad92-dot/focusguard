/**
 * timerService.js — the FocusGuard state machine.
 *
 * Responsible for *when* things happen; it knows nothing about how breaks look
 * or how analytics are stored. It drives a single 1-second GLib timeout while a
 * session is running and parks itself completely (zero timers) when the user is
 * away for a long time, so idle CPU is genuinely nil.
 *
 * State machine
 * -------------
 *            start()                remaining==0
 *   IDLE ───────────────▶ WORK ──────────────────▶ BREAK / LONG_BREAK
 *     ▲                    │  ▲                          │
 *     │ stop()            pause()│ resume()       remaining==0│ (auto-start-work)
 *     │                    ▼  │                          ▼
 *     └──────────────── PAUSED                          WORK
 *
 * Any running phase can transition to SUSPENDED (idle / fullscreen / media /
 * deep-work) and back without losing the countdown.
 *
 * The host (extension.js) supplies a small `context` object so the timer stays
 * decoupled and unit-testable:
 *   context.isIdle(): boolean
 *   context.idleTimeMs(): number
 *   context.getPostpone(): { postpone: boolean, reason: string|null }
 */
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import { TimerState, TimerMode, TICK_INTERVAL_MS } from '../utils/constants.js';
import { clamp } from '../utils/helpers.js';
import { Logger } from '../utils/logger.js';

export const TimerService = GObject.registerClass({
    GTypeName: 'FocusGuardTimerService',
    Signals: {
        'tick': {},                                              // read getters
        'phase-changed': { param_types: [GObject.TYPE_STRING] }, // new state
        'work-started': {},
        'break-due': { param_types: [GObject.TYPE_BOOLEAN] },     // isLong, manual-start
        'break-started': { param_types: [GObject.TYPE_BOOLEAN] }, // isLong
        'break-finished': { param_types: [GObject.TYPE_BOOLEAN] },
        'suspended': { param_types: [GObject.TYPE_STRING] },     // reason
        'resumed': {},
        'escalated': { param_types: [GObject.TYPE_INT] },        // nudge count
        'work-reset': {},                                        // long idle reset
    },
}, class TimerService extends GObject.Object {
    _init(settings, context) {
        super._init();
        this._settings = settings;
        this._ctx = context;

        this._state = TimerState.IDLE;
        this._resumeState = TimerState.WORK;  // what to return to after suspend
        this._suspendReason = null;
        this._remaining = 0;                  // seconds left in current phase
        this._phaseTotal = 0;                 // seconds the phase started with
        this._pomodoroCount = 0;              // completed work blocks this cycle
        this._escalationAccum = 0;            // seconds since last nudge
        this._breakDueEmitted = false;        // 'break-due' fired for this block
        this._parked = false;                 // ticking fully stopped (long idle)
        this._workOverride = null;            // adaptive override (seconds|null)
        this._eyeRemaining = 0;              // 20-min rolling eye-care countdown
        this._sessionElapsed = 0;           // work-seconds elapsed since start()

        this._tickId = 0;
    }

    /**
     * Adaptive scheduling: the host may override the next focus block length
     * (e.g. shorten it when compliance is poor). `null` reverts to the setting.
     */
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
            this._state === TimerState.LONG_BREAK;
    }

    /** Seconds until the next 20-min eye-care reminder (0 when not in a work block). */
    get eyeReminderRemaining() { return this._eyeRemaining; }
    /** Total work-seconds elapsed since the current session was started. */
    get sessionElapsed() { return this._sessionElapsed; }

    get progress() {
        if (this._phaseTotal <= 0)
            return 0;
        return clamp(1 - this._remaining / this._phaseTotal, 0, 1);
    }

    // ---- Lifecycle ----------------------------------------------------------

    /** Begin a fresh focus session (or restart from IDLE/PAUSED/finished). */
    start() {
        this._pomodoroCount = 0;
        this._sessionElapsed = 0;
        this._beginWork();
    }

    /** Toggle pause/resume from the user's perspective. */
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
        this._setState(TimerState.PAUSED);
        this._stopTicking();
    }

    resume() {
        if (this._state !== TimerState.PAUSED)
            return;
        this._suspendReason = null;
        this._setState(this._resumeState);
        this._ensureTicking();
    }

    /** Stop entirely and clear the session. */
    stop() {
        this._stopTicking();
        this._remaining = 0;
        this._phaseTotal = 0;
        this._suspendReason = null;
        this._parked = false;
        this._sessionElapsed = 0;
        this._eyeRemaining = 0;
        this._setState(TimerState.IDLE);
    }

    // ---- User actions on a pending/active break -----------------------------

    /** Jump straight into a break, ending the current focus block early. */
    takeBreakNow() {
        if (this._state === TimerState.WORK || this._state === TimerState.IDLE)
            this._beginBreak();
    }

    /** Skip the upcoming/active break and return to work. */
    skipBreak() {
        if (this._state === TimerState.BREAK || this._state === TimerState.LONG_BREAK)
            this._finishBreak(/* skipped */ true);
        else
            this._beginWork();
    }

    /** Postpone the break by `seconds`, staying in work with a short timer. */
    snooze(seconds) {
        this._escalationAccum = 0;
        this._breakDueEmitted = false;
        this._remaining = Math.max(1, seconds);
        // Keep WORK phase but shrink the remaining time to the snooze window.
        if (this._state !== TimerState.WORK)
            this._setState(TimerState.WORK);
        this._phaseTotal = this._remaining;
        this._ensureTicking();
        this.emit('tick');
    }

    /** Re-evaluate after a settings change (durations, mode, etc.). */
    refreshFromSettings() {
        // Only adopt new durations on the next phase; the current countdown is
        // intentionally preserved so a settings save doesn't yank time away.
    }

    /** Called by the host when the user returns from a parked idle state. */
    onUserActive() {
        if (this._parked) {
            this._parked = false;
            this._leaveSuspend();
            this._ensureTicking();
        }
    }

    // ---- Internal phase transitions ----------------------------------------

    /** Whether the *next* break in the cycle would be a long one. */
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
        this._eyeRemaining = 20 * 60; // reset 20-min eye-care timer per block
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
            this._pomodoroCount = 0; // reset the cycle after a long break
        this.emit('break-finished', skipped);

        if (this._settings.autoStartWork)
            this._beginWork();
        else
            this.stop();
    }

    // ---- Suspend / resume (automatic) --------------------------------------

    _enterSuspend(reason) {
        if (this._state === TimerState.SUSPENDED) {
            if (this._suspendReason !== reason) {
                this._suspendReason = reason;
                this.emit('suspended', reason);
            }
            return;
        }
        this._resumeState = this._state;
        this._suspendReason = reason;
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

    // ---- The single 1-second heartbeat -------------------------------------

    _ensureTicking() {
        if (this._tickId)
            return;
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
        try {
            this._tickBody();
        } catch (e) {
            Logger.trace(e, 'timer tick');
        }
        return GLib.SOURCE_CONTINUE;
    }

    _tickBody() {
        const blockReason = this._computeBlockReason();

        // --- Long-idle parking: stop all timers until the user returns. ---
        if (blockReason === 'idle' &&
            this._ctx.idleTimeMs() >= this._settings.idleResetThreshold * 1000) {
            if (this._resumeState === TimerState.WORK ||
                this._state === TimerState.WORK ||
                this._state === TimerState.SUSPENDED) {
                this._remaining = this._effectiveWorkDuration;
                this._phaseTotal = this._remaining;
                this.emit('work-reset');
            }
            this._enterSuspend('idle');
            this._parked = true;
            this._stopTicking();
            return;
        }

        if (blockReason) {
            this._enterSuspend(blockReason);
            return; // keep ticking so we notice the moment it clears
        }

        if (this._state === TimerState.SUSPENDED)
            this._leaveSuspend();

        // --- Normal countdown. ---
        if (this._state === TimerState.WORK) {
            if (this._remaining > 0)
                this._remaining -= 1;

            this._sessionElapsed += 1;

            // Roll the 20-min eye-care counter; only ticks during active work.
            if (this._eyeRemaining > 0) {
                this._eyeRemaining -= 1;
                if (this._eyeRemaining <= 0)
                    this._eyeRemaining = 20 * 60;
            }

            if (this._remaining <= 0) {
                if (this._settings.deepWorkMode) {
                    // Deep work: keep focusing, never interrupt. Silently start
                    // a fresh block so focus time keeps accruing.
                    this._beginWork();
                } else if (this._settings.autoStartBreaks) {
                    this._beginBreak();
                } else {
                    // Hold in "overtime": the break is due but the user must
                    // act. We announce it once, then escalate periodically.
                    this._remaining = 0;
                    if (!this._breakDueEmitted) {
                        this._breakDueEmitted = true;
                        this.emit('break-due', this._wouldBeLong());
                    }
                    this._maybeEscalate();
                    this.emit('tick');
                }
            } else {
                this.emit('tick');
            }
        } else if (this._state === TimerState.BREAK ||
                   this._state === TimerState.LONG_BREAK) {
            this._remaining -= 1;
            if (this._remaining <= 0)
                this._finishBreak(false);
            else
                this.emit('tick');
        }
    }

    /**
     * Decide whether the timer should currently be held. Order matters:
     * idle first, then external inhibitors (fullscreen / media / screen-share).
     */
    _computeBlockReason() {
        // Note: deep-work is handled in the WORK branch (it keeps you focusing
        // and only suppresses breaks), so it is intentionally NOT a block here.
        if (this._settings.pauseOnIdle && this._ctx.isIdle())
            return 'idle';
        // Check postpone while WORK *and* while already SUSPENDED so the timer
        // stays suspended until the condition actually clears. Without this,
        // state flips WORK→SUSPENDED→WORK every tick because the postpone check
        // is skipped the moment state becomes SUSPENDED.
        if (this._state === TimerState.WORK || this._state === TimerState.SUSPENDED) {
            const decision = this._ctx.getPostpone();
            if (decision.postpone)
                return decision.reason;
        }
        return null;
    }

    /**
     * Escalation only matters once a break is *due* but is being held back
     * (e.g. the user dismissed the notification). We approximate "ignored" as
     * the work block running into overtime when auto-start is off — here we
     * surface periodic nudges while a break-style reminder is pending.
     */
    _maybeEscalate() {
        if (!this._settings.escalateIgnored)
            return;
        // Only escalate in the final stretch where a reminder is imminent and
        // the user keeps pushing past it via snooze.
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
