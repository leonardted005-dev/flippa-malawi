import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import type { ProblemDetails } from '@fa/contracts';

const PROBLEM_BASE = 'https://errors.flippa-africa.local';

function extractCode(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object' && 'code' in payload) {
    const code = (payload as Record<string, unknown>).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return undefined;
}

function toProblem(exception: unknown, instance: string | undefined): ProblemDetails {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return { type: `${PROBLEM_BASE}/${status}`, title: exception.message, status, instance };
    }

    const record = payload as Record<string, unknown>;
    const message = record.message;
    const problems = record.problems; // structured field errors, e.g. Zod issues
    return {
      type: `${PROBLEM_BASE}/${status}`,
      title: typeof record.error === 'string' ? record.error : exception.message,
      status,
      detail: Array.isArray(message)
        ? message.join('; ')
        : typeof message === 'string'
          ? message
          : undefined,
      instance,
      code: extractCode(payload),
      ...(Array.isArray(problems) ? { problems } : {}),
    };
  }

  // Unknown errors must never leak internal details to clients.
  return {
    type: `${PROBLEM_BASE}/500`,
    title: 'Internal Server Error',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    instance,
  };
}

/**
 * Converts any thrown value into an RFC 7807 `application/problem+json` body.
 * 5xx responses are logged server-side but return a generic title to clients.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const problem = toProblem(exception, request.originalUrl);

    if (problem.status >= 500) {
      this.logger.error(
        `Unhandled ${problem.status} on ${request.method} ${request.originalUrl}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(problem.status).type('application/problem+json').json(problem);
  }
}
