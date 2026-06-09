# FocusGuard — build & install automation
#
#   make install     build, compile schemas and install to your user dir
#   make pack        produce a distributable focusguard@dilshad.dev.shell-extension.zip
#   make enable      enable the extension (after install + shell reload)
#   make uninstall   remove the installed copy
#   make lint        syntax-check every JS source file
#
# Reload the shell after install:  Wayland → log out/in,  X11 → Alt+F2, r, Enter.

UUID        := focusguard@dilshad.dev
EXT_DIR     := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMA_DIR  := schemas
BUILD_DIR   := build
ZIP         := $(UUID).shell-extension.zip

# Everything that ships inside the extension.
SOURCES := metadata.json extension.js prefs.js stylesheet.css \
           services ui utils schemas

JS_FILES := $(shell find . -name '*.js' -not -path './build/*' -not -path './node_modules/*')

.PHONY: all
all: compile-schemas

# --- Schema -----------------------------------------------------------------
.PHONY: compile-schemas
compile-schemas:
	glib-compile-schemas --strict $(SCHEMA_DIR)
	@echo "✓ schemas compiled"

# --- Lint -------------------------------------------------------------------
.PHONY: lint
lint:
	@ok=1; for f in $(JS_FILES); do \
		node --input-type=module --check < "$$f" || { echo "✗ $$f"; ok=0; }; \
	done; \
	if [ $$ok -eq 1 ]; then echo "✓ all JS files parse"; else echo "✗ syntax errors"; exit 1; fi

# --- Install (developer workflow) -------------------------------------------
.PHONY: install
install: compile-schemas
	@mkdir -p "$(EXT_DIR)"
	@cp -r $(SOURCES) "$(EXT_DIR)/"
	@echo "✓ installed to $(EXT_DIR)"
	@echo "  Reload GNOME Shell, then: gnome-extensions enable $(UUID)"

.PHONY: uninstall
uninstall:
	@rm -rf "$(EXT_DIR)"
	@echo "✓ removed $(EXT_DIR)"

# --- Packaging (for distribution / EGO upload) ------------------------------
# Uses the official packer so the produced zip matches what extensions.gnome.org
# expects (schemas compiled, extra sources declared).
.PHONY: pack
pack: lint
	@rm -f $(ZIP)
	gnome-extensions pack \
		--force \
		--extra-source=services \
		--extra-source=ui \
		--extra-source=utils \
		--extra-source=stylesheet.css \
		.
	@echo "✓ created $(ZIP)"

.PHONY: pack-all
pack-all: lint
	@echo "Packaging both ESM and Legacy versions..."
	@rm -rf build/pack
	@mkdir -p build/pack/esm build/pack/legacy
	@git archive --format=tar development | tar -x -C build/pack/esm
	@git archive --format=tar main | tar -x -C build/pack/legacy
	@echo "Building ESM (Modern) version..."
	@cd build/pack/esm && gnome-extensions pack --force --extra-source=services --extra-source=ui --extra-source=utils --extra-source=stylesheet.css .
	@mv build/pack/esm/$(ZIP) ./focusguard-modern@dilshad.dev.shell-extension.zip
	@echo "Building Legacy version..."
	@cd build/pack/legacy && gnome-extensions pack --force --extra-source=services --extra-source=ui --extra-source=utils --extra-source=stylesheet.css .
	@mv build/pack/legacy/$(ZIP) ./focusguard-legacy@dilshad.dev.shell-extension.zip
	@rm -rf build/pack
	@echo "✓ created focusguard-modern@dilshad.dev.shell-extension.zip (GNOME 45+)"
	@echo "✓ created focusguard-legacy@dilshad.dev.shell-extension.zip (GNOME 40-44)"

# --- Install straight from the packed zip (mirrors what users do) -----------
.PHONY: install-zip
install-zip: pack
	gnome-extensions install --force $(ZIP)
	@echo "✓ installed from $(ZIP)"

.PHONY: enable
enable:
	gnome-extensions enable $(UUID)

.PHONY: disable
disable:
	gnome-extensions disable $(UUID)

.PHONY: prefs
prefs:
	gnome-extensions prefs $(UUID)

# --- Live debugging ---------------------------------------------------------
.PHONY: logs
logs:
	journalctl -f -o cat /usr/bin/gnome-shell | grep --line-buffered FocusGuard

.PHONY: clean
clean:
	@rm -f $(ZIP) $(SCHEMA_DIR)/gschemas.compiled
	@rm -rf $(BUILD_DIR)
	@echo "✓ cleaned"
