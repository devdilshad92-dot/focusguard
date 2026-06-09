/**
 * soundService.js — plays short cues from the system sound theme.
 *
 * Uses the compositor's built-in sound player (`global.display.get_sound_player()`),
 * which routes through the freedesktop sound-naming spec and respects the user's
 * system sound settings. No external dependency, no audio files to ship.
 */
import { Logger } from '../utils/logger.js';

export class SoundService {
    constructor(settings) {
        this._settings = settings;
        this._player = null;
        try {
            this._player = global.display.get_sound_player();
        } catch (e) {
            Logger.trace(e, 'sound player unavailable');
        }
    }

    /**
     * Play a named theme sound (e.g. 'complete', 'message-new-instant').
     * Silently no-ops when sounds are disabled or the player is unavailable.
     */
    play(themeName, displayName = 'FocusGuard') {
        if (!this._player || !this._settings.enableSounds)
            return;
        try {
            this._player.play_from_theme(themeName, displayName, null);
        } catch (e) {
            Logger.debug('sound failed:', e.message);
        }
    }

    destroy() {
        this._player = null;
        this._settings = null;
    }
}
