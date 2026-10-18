import { BadRequestException, ConflictException, HttpStatus, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { toErrorResponse } from './api-exception.filter';

/** Builds the error TypeORM raises, with the driver fields the filter reads. */
function queryFailure(code: string, constraint: string): QueryFailedError {
  const error = new QueryFailedError('UPDATE ...', [], new Error('rejected'));
  (error as unknown as { driverError: unknown }).driverError = { code, constraint };
  return error;
}

describe('toErrorResponse', () => {
  it('passes our own coded failures through untouched', () => {
    const { status, body } = toErrorResponse(
      new ConflictException({
        code: 'INSUFFICIENT_INVENTORY',
        message: 'Not enough',
        productId: 'p1',
        requested: 4,
      }),
    );

    expect(status).toBe(HttpStatus.CONFLICT);
    expect(body).toEqual({
      code: 'INSUFFICIENT_INVENTORY',
      message: 'Not enough',
      productId: 'p1',
      requested: 4,
    });
  });

  it('gives Nest built-in failures a code of their own', () => {
    expect(toErrorResponse(new NotFoundException()).body.code).toBe('NOT_FOUND');
    expect(toErrorResponse(new BadRequestException('bad uuid')).body.code).toBe('VALIDATION_FAILED');
  });

  it('keeps the field list from a validation failure', () => {
    const { status, body } = toErrorResponse(
      new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: ['quantity must not be less than 1', 'productId must be a UUID'],
      }),
    );

    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.message).toBe('quantity must not be less than 1; productId must be a UUID');
    expect(body.details).toHaveLength(2);
  });

  it('omits details when the message already carries everything', () => {
    const { body } = toErrorResponse(new BadRequestException('Validation failed (uuid is expected)'));
    expect(body.details).toBeUndefined();
  });

  it('names the constraint when the database rejects a write', () => {
    const { status, body } = toErrorResponse(queryFailure('23505', 'coupons_milestone_unique'));

    expect(status).toBe(HttpStatus.CONFLICT);
    // A backstop that can only fire if a check above it is wrong, so it still
    // reports something a caller can act on.
    expect(body.code).toBe('MILESTONE_ALREADY_REWARDED');
    expect(body.constraint).toBe('coupons_milestone_unique');
  });

  it('falls back to a generic conflict for an unmapped constraint', () => {
    const { body } = toErrorResponse(queryFailure('23514', 'products_inventory_non_negative'));
    expect(body.code).toBe('CONSTRAINT_VIOLATED');
  });

  it('treats an oversized body as a client error, not a server fault', () => {
    // body-parser throws a plain Error carrying a status, not an HttpException.
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      type: 'entity.too.large',
    });

    const { status, body } = toErrorResponse(tooLarge);
    expect(status).toBe(413);
    expect(body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('does not call a non-400 client error a validation failure', () => {
    // 415 from body-parser: the status is right, but it is not a validation
    // failure, and VALIDATION_FAILED is documented as meaning 400.
    const charset = Object.assign(new Error('unsupported charset "KLINGON"'), { status: 415 });
    expect(toErrorResponse(charset).body.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    const other = Object.assign(new Error('not acceptable'), { status: 406 });
    const { status, body } = toErrorResponse(other);
    expect(status).toBe(406);
    expect(body.code).toBe('CLIENT_ERROR');
  });

  it('never leaks the detail of an unexpected error', () => {
    const { status, body } = toErrorResponse(new Error('connection string: postgres://user:pw@host'));

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body).toEqual({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
    expect(JSON.stringify(body)).not.toContain('postgres://');
  });
});
