# FocusGuard

> Premium break reminders, focus sessions and wellness nudges for GNOME — built
> for developers, remote workers and office professionals.

FocusGuard helps you stay healthy and focused without becoming annoying. It is
idle-aware, postpones itself during meetings, presentations and fullscreen apps,
and adapts to how you actually work.

![panel indicator](assets/screenshot-panel.png)

---

## ✨ Features

### ⏱️ Centralized Drift-Free Timer Engine
- **Absolute Time Sync:** Uses `Date.now()` delta calculation to ensure zero-drift accuracy across system suspends, lock screen events, or system clock updates.
- **Leak-Free Heartbeat:** Actively cleans up timeout callbacks using strict `GLib.SOURCE_REMOVE` returns to prevent duplicate ticking or memory bloat in GNOME Shell.

### 🧠 Centralized Deep Work Detection (Intense Work Mode)
- **Intense Focus Heuristic:** Automatically monitors active windows (such as VS Code, JetBrains Suite, Cursor, terminal emulators) to identify active coding sessions.
- **Smart Reminder Deferral:** Delays break, eye care, and hydration reminders when you are in flow. Reminders are held at 0 and postponed until a natural pause (idle time > 15s or switching focus away) occurs.

### 🖥️ Real-time Dropdown Dashboard
- **Flicker-Free Live Metrics:** Dropdown menu items (timers, focus scores, active goals) update smoothly every second.
- **Zero-CPU Idle Footprint:** The update loop is connected directly to the menu's open state, spinning up only when the menu is visible and shutting down immediately upon closing.

### 👁️ 20-20-20 Eye Care System
- **State Restoration:** Prevents countdown conflicts. The main focus session timer state and duration are backed up when entering an eye care break, and seamlessly restored upon completion, snooze, or skip.
- **Compliance Tracking:** Tracks shown, completed, and skipped eye breaks.

### 💧 Hydration Tracking
- **Water Consumption Log:** Quick top-panel water logging with a manual "Reset Water Counter" menu option and native confirmation dialogs.
- **Smart Rollover:** Automatically archives logs at midnight, tracking consumption relative to local day keys.

### 🎯 Goal-Based Focus Sessions
- **Intentionality Dialog:** Prompting the user with a goal-setting dialog (*"What are you working on today?"*) before a focus session begins.
- **Persistent Progress:** Keeps your active goal prominently displayed at the top of the dashboard.

### 📈 Metrics & Weekly reports
- **Today's Focus Score:** Displays a 0-100 score on the dashboard combining focus time, break compliance, hydration, and eye care consistency.
- **Burnout Risk Engine:** Analyzes continuous work blocks against recovery scores to alert the user of burnout hazards.
- **Weekly Summary:** Modal summary aggregating total focus, compliance percentages, average scores, productive days, and longest sessions.

### 🔧 Full Settings Page
- Native preferences window backed by Adw widgets.
- Customizable **Idle Threshold** dropdown (5, 10, 15, 20, 30 minutes) replacing slider settings.
- **Import / export** configuration as JSON.

---

## 📁 Project structure

```
focusguard/
├── metadata.json            # extension manifest (UUID, shell-versions, schema)
├── extension.js             # entry point / orchestrator (enable / disable)
├── prefs.js                 # preferences entry point (Adwaita)
├── stylesheet.css           # shell styling (indicator + overlay)
├── schemas/                 # GSettings schema (source of truth for prefs)
│   └── org.gnome.shell.extensions.focusguard.gschema.xml
├── services/                # logic, no UI
│   ├── settingsManager.js   #   typed GSettings wrapper + import/export
│   ├── idleMonitor.js       #   Mutter idle watches
│   ├── inhibitorDetector.js #   fullscreen / media / screen-share detection
│   ├── timerService.js      #   the state machine (work/break/pomodoro)
│   ├── analyticsService.js  #   statistics + adaptive scheduling
│   ├── notificationService.js
│   ├── soundService.js
│   └── gitStreakService.js
├── ui/                      # presentation
│   ├── panelIndicator.js    #   top-bar button + popup menu
│   ├── breakOverlay.js      #   fullscreen break experience
│   └── prefs/               #   one module per preferences page + widgets
├── utils/                   # pure helpers (logger, constants, helpers)
├── assets/                  # screenshots / artwork
└── docs/                    # review checklist + roadmap
```

**Design principle:** `utils` → `services` → `ui` → `extension.js`. Lower layers
never import higher ones. `services` and `utils` contain no shell-only imports,
so they are safe to reuse in the preferences process and to unit-test.

---

## 🚀 Installation

### Requirements
- GNOME Shell **45 – 49** (Wayland or X11)
- `gnome-shell`, `glib2-devel` (for `glib-compile-schemas`), `make`, `node`
  (Node is only used for the lint target.)

### From source (developer install)

```bash
git clone https://github.com/dilshad/focusguard.git
cd focusguard
make install
```

Then reload GNOME Shell and enable it:

- **Wayland:** log out and back in.
- **X11:** press `Alt`+`F2`, type `r`, press `Enter`.

```bash
gnome-extensions enable focusguard@dilshad.dev
gnome-extensions prefs  focusguard@dilshad.dev   # open settings
```

### From a packaged zip

```bash
make install-zip        # builds the zip and installs it
# or, with an existing zip:
gnome-extensions install --force focusguard@dilshad.dev.shell-extension.zip
```

---

## 🔧 Build

```bash
make lint              # node --check on every JS file
make compile-schemas   # glib-compile-schemas --strict schemas/
make install           # copy sources + schemas into your user extensions dir
make logs              # tail FocusGuard log lines from the journal
```

Enable verbose logging by launching the shell with `FOCUSGUARD_DEBUG=1`.

---

## 📦 Packaging (for extensions.gnome.org)

```bash
make pack
```

This runs the official `gnome-extensions pack`, which:
1. compiles the schema,
2. bundles `metadata.json`, `extension.js`, `prefs.js`, `stylesheet.css` and the
   `services/`, `ui/`, `utils/` trees (declared via `--extra-source`),
3. produces `focusguard@dilshad.dev.shell-extension.zip`.

Upload that zip at <https://extensions.gnome.org/upload/>.

> **Tip:** Before uploading, test the *packed* artifact, not just your dev
> install: `make install-zip`, reload the shell, and exercise every feature.

---

## 🧰 Troubleshooting

| Symptom | Fix |
| --- | --- |
| Extension not listed | Reload the shell; confirm `shell-version` covers your GNOME (`gnome-shell --version`). |
| "Schema not found" | Run `make compile-schemas` (or `make install`, which does it). |
| No countdown in panel | Check **Settings → General → Display** isn't set to *Hidden*. |
| Breaks never fire | You may be idle/fullscreen/in a call — that's by design. Check **Reminders**. |
| Errors | `make logs` (or `journalctl -f -o cat /usr/bin/gnome-shell`). |

---

## 📄 License

GPL-3.0-or-later — see [LICENSE](LICENSE). Required for distribution on
extensions.gnome.org.

See also [`docs/REVIEW_CHECKLIST.md`](docs/REVIEW_CHECKLIST.md) and
[`docs/ROADMAP.md`](docs/ROADMAP.md).
