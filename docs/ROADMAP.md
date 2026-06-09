# FocusGuard — Roadmap

Ordered roughly by value-to-effort. Nothing here blocks the 1.0 release.

## 1.1 — Polish
- [ ] Localisation: extract strings, ship `po/` and `--podir` packaging.
- [ ] Per-day notes / mood tagging on breaks.
- [ ] Custom sound picker (choose theme event or a file).
- [ ] More overlay themes (minimal, nature photo, solid colour).
- [ ] Keyboard shortcut to start/pause and to take a break (global accel).

## 1.2 — Smarter scheduling
- [ ] Multi-process analytics sync via a private D-Bus name so prefs reset never
      races the shell (replaces the current "prefs only reads" guard).
- [ ] Calendar awareness: pull busy/free from GNOME Online Accounts to
      auto-pause during scheduled meetings (not just active calls).
- [ ] Time-of-day profiles (gentler near end of day, stricter in the morning).
- [ ] Per-app rules ("never interrupt me in Blender").

## 1.3 — Health depth
- [ ] Keyboard/mouse activity intensity → RSI-aware micro-break cadence.
- [ ] Configurable stretch routines with images/animations.
- [ ] Standing-desk reminders (sit/stand alternation timer).
- [ ] Optional integration with wearables via a companion service.

## 1.4 — Analytics & insight
- [ ] Monthly/heatmap view; CSV export.
- [ ] Goal trends and weekly email/summary (opt-in, local only).
- [ ] "Best focus window" detection from historical data.

## 1.5 — Developer integrations
- [ ] Git: per-branch streaks, lines/commit velocity in the menu.
- [ ] IDE presence (VS Code / JetBrains) to refine "deep work" auto-detection.
- [ ] CLI (`focusguardctl`) to script start/stop from build/test hooks.

## Technical debt / quality
- [ ] Unit tests for `services/*` and `utils/*` under GJS + a CI workflow.
- [ ] Type-checking via JSDoc + `tsc --checkJs` in CI.
- [ ] Screenshot/CI smoke test on a headless GNOME session.
- [ ] Accessibility audit with Orca.
