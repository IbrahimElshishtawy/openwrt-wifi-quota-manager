export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  mac?: string;
  reconciliationId?: string;
  requestId?: string;
  module?: string;
  operation?: string;
  durationMs?: number;
  status?: string;
  usedBytes?: number;
  quotaBytes?: number;
  source?: string;
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
  requestId?: string;
  module?: string;
  operation?: string;
  durationMs?: number;
  status?: string;
  [key: string]: unknown;
}

export interface ILogger {
  debug(eventOrMsg: string, ...args: unknown[]): void;
  info(eventOrMsg: string, ...args: unknown[]): void;
  warn(eventOrMsg: string, ...args: unknown[]): void;
  error(eventOrMsg: string, ...args: unknown[]): void;
  child(bindings: LogContext): ILogger;
  withCorrelationId(reconciliationId: string): ILogger;
  withRequestId(requestId: string): ILogger;
  withModule(moduleName: string): ILogger;
  startTimer?(operation: string, initialContext?: LogContext): { end: (extraContext?: LogContext) => void };
}
