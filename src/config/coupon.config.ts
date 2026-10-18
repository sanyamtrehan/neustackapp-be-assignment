import { registerAs } from '@nestjs/config';

function positiveInt(name: string, raw: string | undefined, fallback: number): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${raw}`);
  }
  return value;
}

/** n = orders per milestone, x = percent off. Misconfiguration fails at boot, not at checkout. */
export const couponConfig = registerAs('coupon', () => ({
  milestoneInterval: positiveInt('COUPON_N', process.env.COUPON_N, 5),
  percentOff: positiveInt('COUPON_X', process.env.COUPON_X, 10),
}));
