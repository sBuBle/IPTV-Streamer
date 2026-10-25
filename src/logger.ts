export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

export type LogSink = (line: string, level: LogLevel) => void;

const consoleSink: LogSink = (line, level) => {
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
};

/** Serializes Error values so they survive JSON.stringify. */
function normalize(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v;
  }
  return out;
}

/** JSON-lines logger that works the same on Node and Cloudflare Workers. */
export function createLogger(level: LogLevel = "info", bindings: LogFields = {}, sink: LogSink = consoleSink): Logger {
  const min = ORDER[level];
  const write = (lvl: LogLevel, msg: string, fields?: LogFields) => {
    if (ORDER[lvl] < min) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...bindings, ...normalize(fields ?? {}) }), lvl);
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (b) => createLogger(level, { ...bindings, ...b }, sink),
  };
}

export const silentLogger: Logger = createLogger("error", {}, () => {});
