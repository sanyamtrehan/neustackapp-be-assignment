/**
 * Every code this API can return. Codes are part of the contract: a client
 * may branch on them, so they do not change once published. Messages may.
 */
export const ERROR_CODES = [
  'CART_NOT_FOUND',
  'CART_EMPTY',
  'CART_ALREADY_CHECKED_OUT',
  'CART_ITEM_NOT_FOUND',
  'PRODUCT_NOT_FOUND',
  'INSUFFICIENT_INVENTORY',
  'ORDER_NOT_FOUND',
  'COUPON_NOT_FOUND',
  'COUPON_NOT_AVAILABLE',
  'MILESTONE_NOT_REACHED',
  'MILESTONE_ALREADY_REWARDED',
  'PAYMENT_FAILED',
  /** Request body or path parameter failed validation. */
  'VALIDATION_FAILED',
  /** No such route. */
  'NOT_FOUND',
  /** Request body larger than the server accepts. */
  'PAYLOAD_TOO_LARGE',
  /** A database constraint rejected the write. A backstop, not an expected path. */
  'CONSTRAINT_VIOLATED',
  /** Anything unanticipated. The cause is logged, never returned. */
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** The body returned by every failed request. */
export class ApiError {
  /**
   * Stable machine-readable code a client can branch on, such as
   * `INSUFFICIENT_INVENTORY`.
   */
  code: ErrorCode;

  /** Human readable explanation. Wording may change; the code will not. */
  message: string;

  /**
   * Extra context for codes that carry it, such as `productId` on
   * `INSUFFICIENT_INVENTORY` or `nextMilestone` on `MILESTONE_NOT_REACHED`.
   */
  [key: string]: unknown;
}
