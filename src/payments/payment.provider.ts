/** Injection token for the payment provider, so tests can swap the implementation. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface PaymentCharge {
  /** Idempotency key. The cart id, which is unique per order by construction. */
  reference: string;
  /** Amount to capture, in minor units, after any discount. */
  amountMinor: number;
}

export interface PaymentReceipt {
  reference: string;
}

/**
 * The seam where a real payment service would sit.
 *
 * It exists for one reason: checkout needs a step that can fail *after*
 * inventory has been decremented and a coupon claimed, so the transaction
 * rollback can be tested rather than assumed.
 */
export interface PaymentProvider {
  /**
   * Captures payment for an order.
   *
   * @param charge Amount and idempotency reference.
   * @returns A receipt when the payment succeeds.
   * @throws PaymentDeclinedError when it does not. Thrown inside the checkout
   *   transaction, so everything claimed before it is rolled back.
   */
  charge(charge: PaymentCharge): Promise<PaymentReceipt>;
}

/** Raised by a provider that refuses a charge. Maps to 402 PAYMENT_FAILED. */
export class PaymentDeclinedError extends Error {
  constructor(reason = 'Payment was declined') {
    super(reason);
    this.name = 'PaymentDeclinedError';
  }
}
