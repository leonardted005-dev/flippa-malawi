import type { LoggerService } from '@nestjs/common';

import { getRequestId } from './request-context';

type Level = 'debug' | 'info' | 'warn' | 'error' | 'verbose';

function serialize(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}

/**
 * Structured JSON logger. Every record carries the request id when available.
 * Callers must never pass secrets, tokens, passwords or PII in the message.
 */
export class JsonLogger implements LoggerService {
  log(message: unknown, ...optional: unknown[]): void {
    this.write('info', message, optional);
  }

  error(message: unknown, ...optional: unknown[]): void {
    this.write('error', message, optional);
  }

  warn(message: unknown, ...optional: unknown[]): void {
    this.write('warn', message, optional);
  }

  debug(message: unknown, ...optional: unknown[]): void {
    this.write('debug', message, optional);
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    this.write('verbose', message, optional);
  }

  private write(level: Level, message: unknown, optional: unknown[]): void {
    const [first, second] = optional;
    // Nest calls: log(message, context) and error(message, trace, context).
    const context = level === 'error' ? stringOrUndefined(second) : stringOrUndefined(first);
    const trace = level === 'error' ? stringOrUndefined(first) : undefined;

    const record: Record<string, unknown> = {
      level,
      time: new Date().toISOString(),
      requestId: getRequestId(),
      message: serialize(message),
    };
    if (context) {
      record.context = context;
    }
    if (trace) {
      record.trace = trace;
    }

    const line = `${JSON.stringify(record)}\n`;
    if (level === 'error') {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
