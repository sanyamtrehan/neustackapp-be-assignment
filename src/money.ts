/**
 * Money is integer minor units (cents) everywhere. These helpers exist so the
 * one place that divides — a percentage discount — rounds the same way every
 * time and can never produce a fractional or negative amount.
 */

function assertMinorUnits(label: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer in minor units, got ${value}`);
  }
}

/**
 * Half-up percentage, computed without floating point: 10% of 1255 is 126, not 125.
 * Half-up favours the customer on a discount, and being a fixed rule it is
 * reproducible when an order total is audited later.
 */
export function percentOfMinor(amountMinor: number, percent: number): number {
  assertMinorUnits('amount', amountMinor);
  assertMinorUnits('percent', percent);

  const scaled = amountMinor * percent;
  const remainder = scaled % 100;
  // scaled - remainder is an exact multiple of 100, so this division is exact.
  const whole = (scaled - remainder) / 100;
  return remainder >= 50 ? whole + 1 : whole;
}

/**
 * Discount and resulting total for a subtotal. The discount is clamped to the
 * subtotal, so a 100% coupon settles at zero and a total can never go negative.
 */
export function applyPercentDiscount(
  subtotalMinor: number,
  percentOff: number,
): { discountMinor: number; totalMinor: number } {
  const discountMinor = Math.min(percentOfMinor(subtotalMinor, percentOff), subtotalMinor);
  return { discountMinor, totalMinor: subtotalMinor - discountMinor };
}
