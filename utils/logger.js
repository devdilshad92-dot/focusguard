/**
 * logger.js — tiny levelled logger.
 *
 * GNOME's `console`/`log` output ends up in the journal. We prefix every line
 * with the extension name so logs are trivial to filter:
 *
 *   journalctl -f -o cat /usr/bin/gnome-shell | grep FocusGuard
 *
 * Levels can be raised at runtime by setting `FOCUSGUARD_DEBUG=1` in the
 * environment that launches gnome-shell.
 */

const PREFIX = '[FocusGuard]';

/** @enum {number} */
export const LogLevel = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3,
};

let _level = (() => {
    const env = globalThis.GLib?.getenv?.('FOCUSGUARD_DEBUG');
    return env && env !== '0' ? LogLevel.DEBUG : LogLevel.INFO;
})();

/** Override the active log level. */
export function setLevel(level) {
    _level = level;
}

function _emit(level, label, args) {
    if (level > _level)
        return;
    const line = `${PREFIX} ${label}:`;
    // console.* gives nicer formatting for objects than plain log().
    if (level === LogLevel.ERROR)
        console.error(line, ...args);
    else if (level === LogLevel.WARN)
        console.warn(line, ...args);
    else
        console.log(line, ...args);
}

export const Logger = {
    error: (...args) => _emit(LogLevel.ERROR, 'ERROR', args),
    warn: (...args) => _emit(LogLevel.WARN, 'WARN', args),
    info: (...args) => _emit(LogLevel.INFO, 'INFO', args),
    debug: (...args) => _emit(LogLevel.DEBUG, 'DEBUG', args),

    /** Log an exception with context without crashing the shell. */
    trace(error, context = '') {
        const msg = error instanceof Error ? error.stack ?? error.message : String(error);
        _emit(LogLevel.ERROR, 'ERROR', [context, msg].filter(Boolean));
    },
};
