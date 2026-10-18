import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { ApiError, ErrorCode } from './api-error';

/** Postgres SQLSTATEs we can describe better than "something went wrong". */
const CONSTRAINT_SQLSTATES = new Set(['23505', '23514', '23503']);

/**
 * Constraints that can only be hit if a check above them is wrong. They are
 * mapped so the response still means something rather than reading as a bug.
 */
const CONSTRAINT_CODES: Record<string, ErrorCode> = {
  orders_cart_unique: 'CART_ALREADY_CHECKED_OUT',
  orders_coupon_unique: 'COUPON_NOT_AVAILABLE',
  coupons_milestone_unique: 'MILESTONE_ALREADY_REWARDED',
};

function statusToCode(status: number): ErrorCode {
  if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
  if (status === HttpStatus.PAYLOAD_TOO_LARGE) return 'PAYLOAD_TOO_LARGE';
  if (status >= 400 && status < 500) return 'VALIDATION_FAILED';
  return 'INTERNAL_ERROR';
}

/**
 * Express middleware errors, such as body-parser rejecting an oversized or
 * malformed body, are plain Errors carrying an HTTP status. They are ordinary
 * client mistakes, so they must not be reported as a server fault.
 */
function statusBearingError(exception: unknown): number | undefined {
  const status = (exception as { status?: unknown; statusCode?: unknown })?.status
    ?? (exception as { statusCode?: unknown })?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

/**
 * Turns anything thrown into the one error shape this API returns.
 *
 * Kept separate from the filter so it can be tested directly, including the
 * database paths that are hard to provoke through HTTP.
 *
 * @param exception Whatever was thrown.
 * @returns The HTTP status and the body to send.
 */
export function toErrorResponse(exception: unknown): { status: number; body: ApiError } {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'object' && payload !== null) {
      const { statusCode, error, message, ...rest } = payload as Record<string, unknown>;
      const text = Array.isArray(message) ? message.join('; ') : String(message ?? exception.message);

      // Our own throws carry a code; Nest's built-in ones do not.
      if ('code' in rest) {
        return { status, body: { ...rest, code: rest.code as ErrorCode, message: text } };
      }
      // details only when there is more than the message already says.
      const body: ApiError = { code: statusToCode(status), message: text };
      if (Array.isArray(message) && message.length > 1) {
        body.details = message;
      }
      return { status, body };
    }

    return { status, body: { code: statusToCode(status), message: String(payload) } };
  }

  if (exception instanceof QueryFailedError) {
    const driverError = exception.driverError as { code?: string; constraint?: string };
    if (driverError?.code && CONSTRAINT_SQLSTATES.has(driverError.code)) {
      const constraint = driverError.constraint ?? 'unknown';
      return {
        status: HttpStatus.CONFLICT,
        body: {
          code: CONSTRAINT_CODES[constraint] ?? 'CONSTRAINT_VIOLATED',
          message: `The database rejected this write (${constraint})`,
          constraint,
        },
      };
    }
  }

  const clientStatus = statusBearingError(exception);
  if (clientStatus) {
    return {
      status: clientStatus,
      body: {
        code: statusToCode(clientStatus),
        message: (exception as Error).message || 'Request rejected',
      },
    };
  }

  // Unanticipated. The cause is logged by the filter; the client is told
  // nothing about internals.
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
  };
}

/**
 * Catches everything, so no failure can escape as an unshaped response.
 *
 * Without it, a validation failure, a missing route and an unhandled database
 * error each return a different shape, and a client has to special-case all
 * three.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body } = toErrorResponse(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`Unhandled failure: ${String(exception)}`, (exception as Error)?.stack);
    }

    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }
}
