/**
 * constants.js — shared enums, keys and static content.
 *
 * Keeping every magic string and tunable in one place makes the rest of the
 * codebase read like prose and keeps the GSettings keys in exactly one source
 * of truth (mirroring the gschema.xml).
 */

/** Phases of the timer state machine. */
export const TimerState = Object.freeze({
    IDLE: 'idle',           // not running
    WORK: 'work',           // focus block in progress
    BREAK: 'break',         // short/micro break in progress
    LONG_BREAK: 'long-break',
    PAUSED: 'paused',       // paused by user
    SUSPENDED: 'suspended', // auto-paused (idle / inhibited / screen share)
});

/** Why the timer was auto-suspended — surfaced in the UI. */
export const SuspendReason = Object.freeze({
    IDLE: 'idle',
    FULLSCREEN: 'fullscreen',
    INHIBITED: 'inhibited',
    SCREEN_SHARE: 'screen-share',
    DEEP_WORK: 'deep-work',
});

/** GSettings keys — single source of truth for typed access. */
export const Keys = Object.freeze({
    TIMER_MODE: 'timer-mode',
    WORK_DURATION: 'work-duration',
    BREAK_DURATION: 'break-duration',
    LONG_BREAK_DURATION: 'long-break-duration',
    POMODOROS_UNTIL_LONG_BREAK: 'pomodoros-until-long-break',
    AUTO_START_BREAKS: 'auto-start-breaks',
    AUTO_START_WORK: 'auto-start-work',

    PAUSE_ON_IDLE: 'pause-on-idle',
    IDLE_THRESHOLD: 'idle-threshold',
    IDLE_RESET_THRESHOLD: 'idle-reset-threshold',

    REMINDER_STYLE: 'reminder-style',
    ENABLE_NOTIFICATIONS: 'enable-notifications',
    ENABLE_SOUNDS: 'enable-sounds',
    ESCALATE_IGNORED: 'escalate-ignored',
    ESCALATION_INTERVAL: 'escalation-interval',
    POSTPONE_ON_FULLSCREEN: 'postpone-on-fullscreen',
    POSTPONE_ON_INHIBIT: 'postpone-on-inhibit',
    SNOOZE_DURATIONS: 'snooze-durations',
    ADAPTIVE_SCHEDULING: 'adaptive-scheduling',

    OVERLAY_FADE_MS: 'overlay-fade-ms',
    SHOW_STRETCH_TIPS: 'show-stretch-tips',
    SHOW_EYE_CARE: 'show-eye-care',
    SHOW_HYDRATION: 'show-hydration',
    SHOW_BREATHING: 'show-breathing',
    SHOW_POSTURE: 'show-posture',
    ALLOW_SKIP_BREAK: 'allow-skip-break',

    DAILY_FOCUS_GOAL: 'daily-focus-goal',
    DAILY_BREAK_GOAL: 'daily-break-goal',
    DAILY_WATER_GOAL: 'daily-water-goal',
    WATER_REMINDER_ENABLED: 'water-reminder-enabled',
    WATER_REMINDER_INTERVAL: 'water-reminder-interval',

    DEEP_WORK_MODE: 'deep-work-mode',
    PAUSE_ON_SCREEN_SHARE: 'pause-on-screen-share',
    GIT_STREAK_ENABLED: 'git-streak-enabled',
    GIT_REPO_PATH: 'git-repo-path',

    INDICATOR_MODE: 'indicator-mode',
    INDICATOR_POSITION: 'indicator-position',

    ANALYTICS_DATA: 'analytics-data',
    LAST_ACTIVE_DAY: 'last-active-day',
    FIRST_RUN: 'first-run',
});

export const ReminderStyle = Object.freeze({
    NOTIFICATION: 'notification',
    OVERLAY: 'overlay',
    BOTH: 'both',
});

export const TimerMode = Object.freeze({
    SIMPLE: 'simple',
    POMODORO: 'pomodoro',
});

export const IndicatorMode = Object.freeze({
    ICON_AND_COUNTDOWN: 'icon-and-countdown',
    ICON_ONLY: 'icon-only',
    COUNTDOWN_ONLY: 'countdown-only',
    HIDDEN: 'hidden',
});

/**
 * Wellness content shown during breaks. Each entry is intentionally short so it
 * reads at a glance. Translators only need to touch this array.
 */
export const StretchTips = Object.freeze([
    'Roll your shoulders backwards 10 times, then forwards 10 times.',
    'Clasp your hands and stretch your arms above your head.',
    'Gently tilt your head toward each shoulder and hold for 15 seconds.',
    'Stand up and reach for your toes — let your back decompress.',
    'Open your chest: clasp hands behind your back and lift gently.',
    'Stretch each wrist by pulling the fingers back for 15 seconds.',
    'Do 10 slow neck rotations in each direction.',
    'Twist your torso left and right while seated, holding each side.',
]);

export const EyeCareTips = Object.freeze([
    'Look at something 20 feet (6 m) away for 20 seconds — the 20-20-20 rule.',
    'Blink slowly 10 times to re-moisten your eyes.',
    'Palm your eyes: cup your hands over closed eyes for 20 seconds.',
    'Focus on a near object, then a far one, five times.',
    'Look out of a window at the horizon and let your eyes relax.',
]);

export const HydrationTips = Object.freeze([
    'Grab a glass of water — even mild dehydration hurts focus.',
    'Refill your water bottle while you stretch.',
    'A warm tea counts too. Step away and brew one.',
    'Sip slowly — aim for a glass every focus block.',
]);

export const PostureTips = Object.freeze([
    'Sit back fully — let the chair support your lower back.',
    'Drop your shoulders away from your ears.',
    'Bring the top of your screen to eye level.',
    'Keep both feet flat on the floor, knees at ~90°.',
    'Pull your chin back gently to align your neck over your spine.',
]);

export const WalkingTips = Object.freeze([
    'Take a short walk to the window and back.',
    'Walk to refill your water — movement resets your focus.',
    'Stand and pace for a minute while you think.',
]);

/** Breathing exercise pattern (box breathing), in seconds per phase. */
export const BreathingPattern = Object.freeze({
    inhale: 4,
    hold: 4,
    exhale: 4,
    holdEmpty: 4,
    cycles: 4,
});

/** Sound theme event names handled by SoundService (freedesktop sound naming). */
export const Sounds = Object.freeze({
    BREAK_REMINDER: 'bell',   // simple beep when a break is due
    BREAK_START: 'message-new-instant',
    BREAK_END: 'complete',
    ESCALATE: 'dialog-warning',
});

/** How often the panel countdown ticks (ms). One second is plenty. */
export const TICK_INTERVAL_MS = 1000;
