import { applyPercentDiscount, percentOfMinor } from './money';

describe('percentOfMinor', () => {
  it('computes an exact percentage', () => {
    expect(percentOfMinor(1250, 10)).toBe(125);
    expect(percentOfMinor(18999, 100)).toBe(18999);
    expect(percentOfMinor(0, 10)).toBe(0);
  });

  it('rounds half up, so the half cent goes to the customer', () => {
    expect(percentOfMinor(1255, 10)).toBe(126); // 125.5
    expect(percentOfMinor(1254, 10)).toBe(125); // 125.4
    expect(percentOfMinor(1256, 10)).toBe(126); // 125.6
  });

  it('does not drift on values that break floating point arithmetic', () => {
    // 0.1 + 0.2 territory: these are exact in integer minor units.
    expect(percentOfMinor(3330, 10)).toBe(333);
    expect(percentOfMinor(2420, 15)).toBe(363);
    expect(percentOfMinor(999999999, 7)).toBe(70000000);
  });

  it('rejects fractional input rather than silently rounding it', () => {
    expect(() => percentOfMinor(12.5, 10)).toThrow(/integer in minor units/);
    expect(() => percentOfMinor(1250, 10.5)).toThrow(/integer in minor units/);
  });
});

describe('applyPercentDiscount', () => {
  it('returns a discount and the remaining total', () => {
    expect(applyPercentDiscount(1250, 10)).toEqual({ discountMinor: 125, totalMinor: 1125 });
  });

  it('settles at zero for a full discount and never goes negative', () => {
    expect(applyPercentDiscount(1250, 100)).toEqual({ discountMinor: 1250, totalMinor: 0 });
  });

  it('keeps total = subtotal - discount, which the orders table also enforces', () => {
    for (const subtotal of [0, 1, 99, 1255, 18999, 123456789]) {
      for (const percent of [1, 10, 33, 50, 99, 100]) {
        const { discountMinor, totalMinor } = applyPercentDiscount(subtotal, percent);
        expect(totalMinor).toBe(subtotal - discountMinor);
        expect(totalMinor).toBeGreaterThanOrEqual(0);
        expect(discountMinor).toBeLessThanOrEqual(subtotal);
        expect(Number.isInteger(totalMinor)).toBe(true);
      }
    }
  });
});
