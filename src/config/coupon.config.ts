import 'dotenv/config';

function positiveInt(name: string, raw: string | undefined, fallback: number): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${raw}`);
  }
  return value;
}

export interface CouponSettings {
  /** n: every nth placed order makes one coupon available. */
  milestoneInterval: number;
  /** x: percent off, snapshotted onto each coupon when it is generated. */
  percentOff: number;
}

/**
 * Read from the environment on each call so a test can vary n and x. main.ts
 * calls it during bootstrap, so a misconfigured value fails at startup rather
 * than at checkout.
 */
export function couponSettings(): CouponSettings {
  return {
    milestoneInterval: positiveInt('COUPON_N', process.env.COUPON_N, 5),
    percentOff: positiveInt('COUPON_X', process.env.COUPON_X, 10),
  };
}
