import type {
  ILogger,
  LogLevel,
  LogContext,
  StructuredLogEntry,
} from './logger.types.js';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEY_REGEX = /^(password|token|secret|private[_-]?key|auth|authorization|api[_-]?key)$/i;
const SENSITIVE_VALUE_REGEX = /(password|token|secret|key)=[^&\s]+/gi;

export interface LoggerOptions {
  minLevel?: LogLevel;
  bindings?: LogContext;
  sink?: (entry: StructuredLogEntry, formattedJson: string) => void;
  outputJson?: boolean;
}

export class Logger implements ILogger {
  private readonly minLevel: LogLevel;
  private readonly bindings: LogContext;
  private readonly sink?: (entry: StructuredLogEntry, formattedJson: string) => void;
  private readonly outputJson: boolean;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = options.minLevel ?? (process.env.NODE_ENV === 'test' ? 'debug' : 'info');
    this.bindings = options.bindings ? this.sanitizeContext(options.bindings) : {};
    this.sink = options.sink;
    this.outputJson = options.outputJson ?? true;
  }

  public debug(eventOrMsg: string, ...args: unknown[]): void {
    this.write('debug', eventOrMsg, args);
  }

  public info(eventOrMsg: string, ...args: unknown[]): void {
    this.write('info', eventOrMsg, args);
  }

  public warn(eventOrMsg: string, ...args: unknown[]): void {
    this.write('warn', eventOrMsg, args);
  }

  public error(eventOrMsg: string, ...args: unknown[]): void {
    this.write('error', eventOrMsg, args);
  }

  public child(bindings: LogContext): ILogger {
    return new Logger({
      minLevel: this.minLevel,
      bindings: {
        ...this.bindings,
        ...this.sanitizeContext(bindings),
      },
      sink: this.sink,
      outputJson: this.outputJson,
    });
  }

  public withCorrelationId(reconciliationId: string): ILogger {
    return this.child({ reconciliationId });
  }

  private write(level: LogLevel, eventOrMsg: string, args: unknown[]): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const timestamp = new Date().toISOString();
    let event = eventOrMsg;
    let message: string | undefined;
    let extraContext: LogContext = {};

    if (args.length > 0) {
      if (typeof args[0] === 'object' && args[0] !== null) {
        extraContext = this.sanitizeContext(args[0] as LogContext);
        if (args.length > 1) {
          message = args.slice(1).map(String).join(' ');
        }
      } else {
        message = args.map(String).join(' ');
      }
    }

    // If event contains spaces or brackets, extract event name or use as message
    if (eventOrMsg.includes(' ') || eventOrMsg.startsWith('[')) {
      message = message ? `${eventOrMsg} ${message}` : eventOrMsg;
      event = this.inferEventFromMessage(eventOrMsg);
    }

    const entry: StructuredLogEntry = {
      timestamp,
      level,
      event,
      ...(message ? { message: this.sanitizeString(message) } : {}),
      ...this.bindings,
      ...extraContext,
    };

    const formattedJson = JSON.stringify(entry);

    if (this.sink) {
      this.sink(entry, formattedJson);
      return;
    }

    if (process.env.NODE_ENV === 'test') {
      // In tests, avoid noisy console output unless explicit sink
      return;
    }

    if (this.outputJson) {
      if (level === 'error') {
        console.error(formattedJson);
      } else if (level === 'warn') {
        console.warn(formattedJson);
      } else {
        console.log(formattedJson);
      }
    } else {
      const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
      const str = `${prefix} ${event}${message ? `: ${message}` : ''}`;
      if (level === 'error') console.error(str);
      else if (level === 'warn') console.warn(str);
      else console.log(str);
    }
  }

  private inferEventFromMessage(msg: string): string {
    const lower = msg.toLowerCase();
    if (lower.includes('reconciliation started') || lower.includes('reconciliation_started')) return 'reconciliation_started';
    if (lower.includes('reconciliation completed') || lower.includes('reconciliation_completed')) return 'reconciliation_completed';
    if (lower.includes('quota exhausted') || lower.includes('quota_exhausted')) return 'quota_exhausted';
    if (lower.includes('device blocked') || lower.includes('device_blocked') || lower.includes('action=block')) return 'device_blocked';
    if (lower.includes('device unblocked') || lower.includes('device_unblocked') || lower.includes('action=unblock')) return 'device_unblocked';
    if (lower.includes('manual block') || lower.includes('manual_block')) return 'manual_block_protected';
    if (lower.includes('stale quota block removed') || lower.includes('orphan')) return 'orphan_block_removed';
    if (lower.includes('failed') || lower.includes('error')) return 'operation_failed';
    return 'log_message';
  }

  private sanitizeContext(ctx: LogContext): LogContext {
    const cleaned: LogContext = {};
    for (const [key, value] of Object.entries(ctx)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        cleaned[key] = '[REDACTED]';
      } else if (typeof value === 'string') {
        cleaned[key] = this.sanitizeString(value);
      } else if (value instanceof Error) {
        cleaned[key] = this.sanitizeString(value.message);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        cleaned[key] = this.sanitizeContext(value as LogContext);
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }

  private sanitizeString(str: string): string {
    return str.replace(SENSITIVE_VALUE_REGEX, '$1=[REDACTED]');
  }
}

export const logger = new Logger();
