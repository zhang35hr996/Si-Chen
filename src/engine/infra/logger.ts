/**
 * Ring-buffer logger (skeleton-plan §10): keeps the last `capacity` entries
 * in memory for the debug panel's "bug report bundle" export; optional sinks
 * (console in dev) receive every entry as it is written.
 */
import { formatErrorTag, type GameError, type ErrorSeverity } from "./errors";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  /** Monotonic sequence number — survives ring-buffer eviction gaps. */
  readonly seq: number;
  readonly level: LogLevel;
  readonly message: string;
  /** Wall-clock ms; injectable for tests. */
  readonly timestamp: number;
  readonly data?: unknown;
}

export interface LoggerSink {
  write(entry: LogEntry): void;
}

export interface LoggerOptions {
  capacity?: number;
  sinks?: LoggerSink[];
  /** Clock injection for deterministic tests. */
  now?: () => number;
}

export const DEFAULT_LOG_CAPACITY = 500;

const SEVERITY_TO_LEVEL: Record<ErrorSeverity, LogLevel> = {
  fatal: "error",
  error: "error",
  warn: "warn",
};

export class RingBufferLogger {
  private readonly capacity: number;
  private readonly sinks: LoggerSink[];
  private readonly now: () => number;
  private buffer: LogEntry[] = [];
  private nextSeq = 1;

  constructor(options: LoggerOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_LOG_CAPACITY;
    this.sinks = options.sinks ?? [];
    this.now = options.now ?? Date.now;
  }

  debug(message: string, data?: unknown): void {
    this.write("debug", message, data);
  }

  info(message: string, data?: unknown): void {
    this.write("info", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.write("warn", message, data);
  }

  error(message: string, data?: unknown): void {
    this.write("error", message, data);
  }

  /** The one entry a player-visible degradation must produce. */
  logGameError(error: GameError): void {
    this.write(SEVERITY_TO_LEVEL[error.severity], `${formatErrorTag(error)}: ${error.message}`, {
      category: error.category,
      code: error.code,
      severity: error.severity,
      ...(error.context !== undefined ? { context: error.context } : {}),
      ...(error.cause !== undefined ? { cause: String(error.cause) } : {}),
    });
  }

  /** Oldest → newest. */
  entries(): readonly LogEntry[] {
    return [...this.buffer];
  }

  /** JSON for the debug panel's bug-report bundle. */
  exportJson(): string {
    return JSON.stringify(this.buffer, null, 2);
  }

  clear(): void {
    this.buffer = [];
  }

  private write(level: LogLevel, message: string, data?: unknown): void {
    const entry: LogEntry = {
      seq: this.nextSeq++,
      level,
      message,
      timestamp: this.now(),
      ...(data !== undefined ? { data } : {}),
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
    for (const sink of this.sinks) {
      try {
        sink.write(entry);
      } catch {
        // A broken sink must never break the game; the ring buffer still has the entry.
      }
    }
  }
}

export const consoleSink: LoggerSink = {
  write(entry: LogEntry): void {
    const fn = console[entry.level] ?? console.log;
    fn(`[${entry.level}] #${entry.seq} ${entry.message}`, entry.data ?? "");
  },
};

export function createLogger(options: LoggerOptions = {}): RingBufferLogger {
  return new RingBufferLogger(options);
}
