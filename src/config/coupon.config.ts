import 'dotenv/config';

function boundedInt(
  name: string,
  raw: string | undefined,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}, got ${raw}`);
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
    milestoneInterval: boundedInt('COUPON_N', process.env.COUPON_N, 5),
    // 100 is the ceiling the coupons_percent_off_range constraint enforces;
    // without it the service starts and then cannot issue a single coupon.
    percentOff: boundedInt('COUPON_X', process.env.COUPON_X, 10, 100),
  };
}
