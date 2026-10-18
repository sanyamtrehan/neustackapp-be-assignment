import { couponSettings } from './coupon.config';

describe('couponSettings', () => {
  const original = { n: process.env.COUPON_N, x: process.env.COUPON_X };
  afterEach(() => {
    process.env.COUPON_N = original.n;
    process.env.COUPON_X = original.x;
  });

  it('reads the configured values', () => {
    process.env.COUPON_N = '3';
    process.env.COUPON_X = '25';
    expect(couponSettings()).toEqual({ milestoneInterval: 3, percentOff: 25 });
  });

  it.each(['0', '-1', '2.5', 'abc'])('refuses COUPON_N of %p', (value) => {
    process.env.COUPON_N = value;
    expect(() => couponSettings()).toThrow(/COUPON_N/);
  });

  // A percentage above 100 passed the old check, and then every coupon
  // generation failed on the coupons_percent_off_range constraint.
  it.each(['101', '150', '0'])('refuses COUPON_X of %p at startup', (value) => {
    process.env.COUPON_X = value;
    expect(() => couponSettings()).toThrow(/COUPON_X must be an integer between 1 and 100/);
  });

  it('allows a full one hundred percent discount', () => {
    process.env.COUPON_X = '100';
    expect(couponSettings().percentOff).toBe(100);
  });
});
