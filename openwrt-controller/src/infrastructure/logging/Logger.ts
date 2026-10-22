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

// Comprehensive regex matching sensitive object keys
const SENSITIVE_KEY_REGEX =
  /(password|passwd|token|secret|private[_-]?key|ssh[_-]?key|auth|authorization|api[_-]?key|admin[_-]?token|credentials)/i;

// Regex patterns to redact sensitive credentials from string values
const SENSITIVE_KV_REGEX = /(password|passwd|token|secret|key|apikey|admintoken)=[^&\s]+/gi;
const BEARER_TOKEN_REGEX = /Bearer\s+[A-Za-z0-9_\-\.]+/gi;
const PRIVATE_KEY_REGEX = /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/gi;
const URL_CREDENTIALS_REGEX = /([a-zA-Z0-9+.-]+:\/\/[^:]+:)[^@]+(@.+)/gi;

export interface LoggerOptions {
  minLevel?: LogLevel | undefined;
  bindings?: LogContext | undefined;
  sink?: ((entry: StructuredLogEntry, formattedJson: string) => void) | undefined;
  outputJson?: boolean | undefined;
}

export class Logger implements ILogger {
  private readonly minLevel: LogLevel;
  private readonly bindings: LogContext;
  private readonly sink: ((entry: StructuredLogEntry, formattedJson: string) => void) | undefined;
  private readonly outputJson: boolean;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = options.minLevel ?? (process.env.NODE_ENV === 'test' ? 'debug' : 'info');
    this.bindings = options.bindings ? this.sanitizeContext(options.bindings) : {};
    this.sink = options.sink;

    const isExplicitJson = process.env.LOG_FORMAT === 'json';
    const isExplicitPretty = process.env.LOG_FORMAT === 'pretty';
    const isProd = process.env.NODE_ENV === 'production';
    this.outputJson = options.outputJson ?? (isExplicitJson || (isProd && !isExplicitPretty));
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

  public withRequestId(requestId: string): ILogger {
    return this.child({ requestId });
  }

  public withModule(moduleName: string): ILogger {
    return this.child({ module: moduleName });
  }

  /**
   * Times an asynchronous or multi-step operation and logs structured completion event.
   */
  public startTimer(operation: string, initialContext: LogContext = {}): { end: (extraContext?: LogContext) => void } {
    const start = process.hrtime.bigint();
    return {
      end: (extraContext: LogContext = {}) => {
        const diffNs = process.hrtime.bigint() - start;
        const durationMs = Math.round((Number(diffNs) / 1_000_000) * 100) / 100;
        this.info(`${operation}_completed`, {
          operation,
          durationMs,
          ...initialContext,
          ...extraContext,
        });
      },
    };
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
      const line = this.formatTerminalLine(entry);
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    }
  }

  private formatTerminalLine(entry: StructuredLogEntry): string {
    const time = entry.timestamp.substring(11, 19);

    // Level styling with ANSI colors
    let levelBadge = `[${entry.level.toUpperCase()}]`;
    if (entry.level === 'error') {
      levelBadge = `\x1b[1;31m[ERROR]\x1b[0m`;
    } else if (entry.level === 'warn') {
      levelBadge = `\x1b[1;33m[WARN ]\x1b[0m`;
    } else if (entry.level === 'info') {
      levelBadge = `\x1b[1;32m[INFO ]\x1b[0m`;
    } else if (entry.level === 'debug') {
      levelBadge = `\x1b[1;36m[DEBUG]\x1b[0m`;
    }

    // Module tag
    let moduleTag = '';
    const rawModule = (entry.module as string) || '';
    const event = entry.event || '';
    if (rawModule === 'resilience' || event.startsWith('circuit_breaker')) {
      moduleTag = `\x1b[35m[Resilience]\x1b[0m `;
    } else if (rawModule === 'quota' || event.includes('quota') || event.includes('reconciliation')) {
      moduleTag = `\x1b[34m[Quota]\x1b[0m `;
    } else if (rawModule === 'firewall' || event.includes('firewall') || event.includes('block')) {
      moduleTag = `\x1b[33m[Firewall]\x1b[0m `;
    } else if (rawModule === 'openwrt' || event.includes('ssh') || event.includes('ubus')) {
      moduleTag = `\x1b[36m[OpenWrt]\x1b[0m `;
    } else if (rawModule) {
      moduleTag = `\x1b[90m[${rawModule}]\x1b[0m `;
    }

    // Clean human-friendly event mapping
    let text = '';
    if (event === 'circuit_breaker_opened') {
      const cooldownSec = entry.resetTimeoutMs ? Math.round(Number(entry.resetTimeoutMs) / 1000) : 10;
      text = `⚠️ Router unreachable via SSH. Circuit breaker OPEN (cooldown: ${cooldownSec}s)`;
    } else if (event === 'circuit_breaker_half_open') {
      text = `🔍 Cooldown elapsed. Probing OpenWrt router connection...`;
    } else if (event === 'circuit_breaker_closed') {
      text = `✅ OpenWrt router reachable. Circuit breaker CLOSED.`;
    } else if (event === 'circuit_breaker_open') {
      text = `⏸️ OpenWrt operations paused by circuit breaker (cooldown active)`;
    } else if (event === 'reconciliation_started') {
      text = `🔄 Quota reconciliation cycle started`;
    } else if (event === 'reconciliation_completed') {
      text = `✨ Quota reconciliation completed (${entry.durationMs ?? 0}ms)`;
    } else if (event === 'quota_refresh_failed') {
      text = `❌ Router quota refresh failed: ${entry.error || entry.message || 'connection error'}`;
    } else if (event === 'quota_exhausted') {
      const macStr = entry.mac ? ` for MAC ${entry.mac}` : '';
      const used = typeof entry.usedBytes === 'number' ? this.formatBytes(entry.usedBytes) : '';
      const limit = typeof entry.quotaBytes === 'number' ? this.formatBytes(entry.quotaBytes) : '';
      const stats = used && limit ? ` (${used} / ${limit})` : '';
      text = `🛑 Quota limit reached${macStr}${stats}`;
    } else if (event === 'device_blocked') {
      const macStr = entry.mac ? ` device ${entry.mac}` : '';
      text = `🔒 Firewall: Blocked${macStr} (source: ${entry.source || 'quota'})`;
    } else if (event === 'device_unblocked') {
      const macStr = entry.mac ? ` device ${entry.mac}` : '';
      text = `🔓 Firewall: Unblocked${macStr}`;
    } else if (event === 'manual_block_protected') {
      const macStr = entry.mac ? ` for MAC ${entry.mac}` : '';
      text = `🛡️ Manual administrator block protected${macStr}`;
    } else if (event === 'orphan_block_removed') {
      const macStr = entry.mac ? ` for MAC ${entry.mac}` : '';
      text = `🧹 Removed stale/orphan firewall block${macStr}`;
    } else {
      text = entry.message ? `${entry.message}` : event;
      if (entry.error && !text.includes(String(entry.error))) {
        text += ` - Error: ${entry.error}`;
      }
    }

    return `\x1b[90m[${time}]\x1b[0m ${levelBadge} ${moduleTag}${text}`;
  }

  private formatBytes(bytes?: number): string {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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

  public sanitizeContext(ctx: LogContext): LogContext {
    const cleaned: LogContext = {};
    for (const [key, value] of Object.entries(ctx)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        cleaned[key] = '[REDACTED]';
      } else if (typeof value === 'string') {
        cleaned[key] = this.sanitizeString(value);
      } else if (value instanceof Error) {
        cleaned[key] = this.sanitizeString(value.message);
      } else if (Array.isArray(value)) {
        cleaned[key] = value.map((item) => {
          if (typeof item === 'string') {
            return this.sanitizeString(item);
          }
          if (typeof item === 'object' && item !== null) {
            return this.sanitizeContext(item as LogContext);
          }
          return item;
        });
      } else if (typeof value === 'object' && value !== null) {
        cleaned[key] = this.sanitizeContext(value as LogContext);
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }

  public sanitizeString(str: string): string {
    return str
      .replace(PRIVATE_KEY_REGEX, '[REDACTED PRIVATE KEY]')
      .replace(BEARER_TOKEN_REGEX, 'Bearer [REDACTED]')
      .replace(URL_CREDENTIALS_REGEX, '$1[REDACTED]$2')
      .replace(SENSITIVE_KV_REGEX, '$1=[REDACTED]');
  }
}

export const logger = new Logger();
