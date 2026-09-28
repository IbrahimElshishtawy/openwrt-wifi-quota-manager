export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  mac?: string;
  reconciliationId?: string;
  usedBytes?: number;
  quotaBytes?: number;
  source?: string;
  durationMs?: number;
  error?: string | unknown;
  [key: string]: unknown;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  message?: string;
  mac?: string;
  reconciliationId?: string;
  [key: string]: unknown;
}

export interface ILogger {
  debug(eventOrMsg: string, ...args: unknown[]): void;
  info(eventOrMsg: string, ...args: unknown[]): void;
  warn(eventOrMsg: string, ...args: unknown[]): void;
  error(eventOrMsg: string, ...args: unknown[]): void;
  child(bindings: LogContext): ILogger;
  withCorrelationId(reconciliationId: string): ILogger;
}
