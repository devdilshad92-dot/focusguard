# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.3] - 2026-06-09

### Fixed
- **Static Analysis Compliance:** Renamed custom settings connection wrapper from `connect` to `observe` to resolve false-positive `EGO-L-003` warnings from `shexli` static analysis.
- **ES Module Alignment:** Replaced legacy imports codebase on `main` branch with modern, fully-stabilized ESM codebase targeting GNOME 45–49.

## [1.0.2] - 2026-06-09

### Added
- **Multi-Package Build Automation:** Configured `make pack-all` to package both modern ESM version (`focusguard-modern@dilshad.dev.shell-extension.zip` for GNOME 45+) and legacy imports version (`focusguard-legacy@dilshad.dev.shell-extension.zip` for GNOME 40–44) automatically from their respective Git branches.
- **GNOME 40–48 version boundaries:** Structured `metadata.json` versions on both branches so they are isolated and do not crash on incompatible systems.

## [1.0.0] - 2026-06-09

### Added
- **Centralized Deep Work Mode (Intense Focus):** Added a smart heuristic to detect active developer apps (such as VS Code, JetBrains IDEs, terminal emulators). All wellness nudges (breaks, eye care, hydration) are automatically postponed and deferred until a natural pause is detected.
- **20-20-20 Eye Care State Backup:** Implemented timer state backup & restore to prevent eye breaks from overriding focus session durations.
- **Hydration Reset & Logging:** Added "Reset Water Counter" with a confirmation dialog. Midnight log archiver automatically resets today's count.
- **Intentional Focus Goal Dialog:** Prompting for focus goals (*"What are you working on today?"*) with developer-oriented hints before beginning a focus session.
- **Real-time Menu Updates:** The panel dropdown updates live every second when open, using a resource-efficient loop that shuts down completely when closed (zero-CPU idle footprint).
- **Adw Combo-backed Preferences:** Configured a dropdown row for the **Idle Threshold** selection (5, 10, 15, 20, 30 minutes) replacing sliders.

### Fixed
- **Drift-free Timer Engine:** Resolved time drift by basing tick calculations on absolute deltas via `Date.now()`.
- **Orphaned Timers:** Fixed duplicate/stale tick intervals on extension disable/reload by returning `GLib.SOURCE_REMOVE` inside timeout loops.
- **Idle Parking Loops:** Prevented continuous reset signal spam when the extension is parked in a long idle state.
- **Signal Disconnect Leakage:** Audited and implemented proper cleanup for setting observers, overlay key handlers, and panel indicator events on destroy.
- **Break Overlay key-press grabbing:** Explicitly disconnected key grab handlers during the overlay hide transition.

---

## [0.1.0] - 2026-05-15

### Added
- Initial release featuring Pomodoro focus blocks, Mutter idle monitoring, sound triggers, and a simple top-bar status icon.
