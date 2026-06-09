# FocusGuard — Extension Review Checklist

A self-audit aligned with the
[extensions.gnome.org review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html).
Run through this before every submission.

## 1. Manifest & metadata
- [x] `metadata.json` has valid `uuid`, `name`, `description`, `shell-version`,
      `url`, `settings-schema`, `gettext-domain`.
- [x] `uuid` matches the installed directory and the schema id namespace.
- [x] `shell-version` lists only versions actually tested (`48`, `49`).
- [x] `version` is an integer; `version-name` is human-readable.

## 2. Lifecycle & resource cleanup (most common rejection reason)
- [x] Everything created in `enable()` is destroyed in `disable()`.
- [x] No work is done at module top-level (only inside `enable`).
- [x] Every `GLib.timeout_add*` source id is stored and removed
      (`timerService`, `analyticsService`, `breakOverlay`).
- [x] Every signal `connect()` is paired with a `disconnect()`
      (`extension._signalIds`, `settingsManager._handlerIds`,
      `panelIndicator._timerHandlers`, per-row `changed::` handlers).
- [x] Mutter idle watches are removed (`idleMonitor.destroy`).
- [x] D-Bus proxy reference dropped (`inhibitorDetector.destroy`).
- [x] Modal grab is released and overlay actor destroyed (`breakOverlay.hide`).
- [x] MessageTray source destroyed (`notificationService.destroy`).
- [x] No lingering main-loop sources after disable (verify with Looking Glass).

## 3. No forbidden patterns
- [x] No synchronous subprocess on the compositor thread — git uses
      `communicate_utf8_async`.
- [x] No `eval`, no remote code loading.
- [x] No monkey-patching of shell internals.
- [x] No deprecated `imports.*` — pure ESM (`import … from 'gi://…'`).
- [x] `Main.notify`/legacy tray APIs not used — modern `MessageTray.Notification`.

## 4. Settings
- [x] Schema compiles with `glib-compile-schemas --strict`.
- [x] All keys have `summary`; ranges where meaningful.
- [x] `prefs.js` runs only GTK/Adw code (no shell imports).
- [x] Bindings cleaned up on window close.

## 5. Performance
- [x] A single 1-second timeout while running; **zero** timers when idle-parked
      or stopped.
- [x] Analytics writes are debounced (5 s) and history is capped (120 days).
- [x] Panel `update()` is O(1) and avoids re-layout thrash.

## 6. UX / HIG / accessibility
- [x] Native Adwaita rows; keyboard-navigable preferences.
- [x] Overlay grabs focus and supports `Esc`.
- [x] Tabular figures so the countdown doesn't jitter.
- [x] Works in light and dark themes.
- [x] Destructive actions confirmed via `Adw.AlertDialog`.

## 7. Robustness
- [x] All external calls (D-Bus, git, sound, modal) wrapped in try/catch and
      degrade gracefully.
- [x] JSON parsing is failure-safe (`safeJsonParse`).
- [x] Import validates types and ignores unknown keys.

## 8. Manual test matrix
- [ ] Simple mode: full work → break → work cycle.
- [ ] Pomodoro: long break after N pomodoros.
- [ ] Idle pause + auto-reset after long idle.
- [ ] Postpone during fullscreen video / a call.
- [ ] Snooze (each duration) and skip.
- [ ] Overlay: appears, counts down, breathing animates, Esc skips.
- [ ] Deep work mode suppresses reminders.
- [ ] Analytics update; weekly chart renders; reset works.
- [ ] Export → import round-trips settings.
- [ ] `disable()` leaves no sources (Looking Glass: `Main.layoutManager`,
      check no FocusGuard actors; no leftover timeouts).
- [ ] Lock screen / unlock does not break the timer.
