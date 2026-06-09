/**
 * gitStreakService.js — optional commit-streak tracking for developers.
 *
 * Shells out to `git` asynchronously (never blocking the compositor) to count
 * today's commits and the current consecutive-day commit streak in a watched
 * repository. Entirely best-effort: any failure (no git, bad path, not a repo)
 * resolves to zeros rather than surfacing an error.
 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Logger } from '../utils/logger.js';
import { localDayKey, dayDiff } from '../utils/helpers.js';

export class GitStreakService {
    constructor(settings) {
        this._settings = settings;
    }

    get enabled() {
        return this._settings.gitStreakEnabled && !!this._settings.gitRepoPath;
    }

    /**
     * Run a git command asynchronously and resolve its stdout (trimmed).
     * @returns {Promise<string|null>}
     */
    _git(args) {
        return new Promise(resolve => {
            const repo = this._settings.gitRepoPath;
            if (!repo || !GLib.file_test(repo, GLib.FileTest.IS_DIR)) {
                resolve(null);
                return;
            }
            try {
                const proc = Gio.Subprocess.new(
                    ['git', '-C', repo, ...args],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
                proc.communicate_utf8_async(null, null, (p, res) => {
                    try {
                        const [, stdout] = p.communicate_utf8_finish(res);
                        resolve(p.get_successful() ? (stdout ?? '').trim() : null);
                    } catch (e) {
                        Logger.debug('git read failed:', e.message);
                        resolve(null);
                    }
                });
            } catch (e) {
                Logger.debug('git spawn failed:', e.message);
                resolve(null);
            }
        });
    }

    /**
     * @returns {Promise<{today:number, streak:number}>}
     */
    async getStats() {
        if (!this.enabled)
            return { today: 0, streak: 0 };

        // Author dates of the last 200 commits, newest first, as YYYY-MM-DD.
        const out = await this._git(['log', '-n', '200', '--date=short', '--pretty=%ad']);
        if (!out)
            return { today: 0, streak: 0 };

        const dates = out.split('\n').filter(Boolean);
        const todayKey = localDayKey();
        const today = dates.filter(d => d === todayKey).length;

        // Walk unique days backwards from today, counting consecutive days.
        const uniqueDays = [...new Set(dates)].sort().reverse();
        let streak = 0;
        let cursor = todayKey;
        for (const day of uniqueDays) {
            if (day === cursor) {
                streak += 1;
                // step the cursor back one calendar day
                const prev = new Date(`${cursor}T00:00:00`);
                prev.setDate(prev.getDate() - 1);
                cursor = localDayKey(prev);
            } else if (dayDiff(day, cursor) > 0) {
                break; // a gap broke the streak
            }
        }
        return { today, streak };
    }

    destroy() {
        this._settings = null;
    }
}
