# FocusGuard

> Premium break reminders, focus sessions and wellness nudges for GNOME — built
> for developers, remote workers and office professionals.

FocusGuard helps you stay healthy and focused without becoming annoying. It is
idle-aware, postpones itself during meetings, presentations and fullscreen apps,
and adapts to how you actually work.

![panel indicator](assets/screenshot-panel.png)

---

## ✨ Features

### Smart break reminders
- Configurable focus intervals (15 / 20 / 30 / 45 / 60 / 90 min, or anything).
- **Pomodoro mode** (25/5, 50/10 or custom) with long breaks.
- **Idle detection** — never reminds you when you're already away.
- **Auto-reset** after long idle periods (a real break already happened).

### Beautiful GNOME integration
- Top-panel indicator with a live countdown and state icon.
- Native popup menu, notifications and sounds.
- Light/dark friendly styling, smooth fades and a calming break overlay.

### Intelligent reminder system
- **Escalating** nudges if a break is repeatedly ignored.
- **Smart postponing** during fullscreen apps, media playback, calls and
  screen sharing (honours system idle-inhibitors).
- Snooze 5 / 10 / 15 minutes, or skip once.
- **Adaptive scheduling** — gently shortens focus blocks when you skip breaks,
  lengthens them when your compliance is high.

### Break experience
- Optional **fullscreen overlay** (Esc to skip).
- Rotating wellness content: **stretches**, **20-20-20 eye-care**,
  **hydration**, **posture** and **walking** prompts.
- Guided **box-breathing** animation.

### Productivity analytics
- Daily & weekly focus time with a bar chart.
- Breaks taken, **break-compliance rate**, current and **longest focus streak**.

### Health features
- Eye-strain prevention, hydration tracking, posture reminders.
- Custom daily wellness goals.

### Developer-focused
- **Deep work mode** (suppress everything).
- Auto-pause while **screen sharing**.
- Optional **git commit-streak** tracking in the menu.

### Full settings page
- Every interval, duration, sound, style and goal is configurable.
- **Import / export** your configuration as JSON; restore defaults.

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
