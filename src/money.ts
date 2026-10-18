/**
 * Money is integer minor units (cents) everywhere. These helpers exist so the
 * one place that divides — a percentage discount — rounds the same way every
 * time and can never produce a fractional or negative amount.
 */

/**
 * Rejects a non-integer money value.
 *
 * @param label Name used in the error message.
 * @param value Value that must be a whole number of minor units.
 * @throws Error if the value is fractional.
 */
function assertMinorUnits(label: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer in minor units, got ${value}`);
  }
}

/**
 * Half-up percentage of an amount, computed without floating point.
 *
 * 10% of 1255 is 126, not 125. Half-up favours the customer on a discount,
 * and being a fixed rule it reproduces the same total when an order is
 * audited later.
 *
 * @param amountMinor Amount in minor units; must be an integer.
 * @param percent Whole percent; must be an integer.
 * @returns The percentage, rounded half up, in minor units.
 * @throws Error if either argument is not an integer, since a float here means
 *   precision was already lost upstream.
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
 * Discount and resulting total for a subtotal.
 *
 * The discount is clamped to the subtotal, so a 100% coupon settles at zero
 * and a total can never go negative. That is invariant 6, which
 * `orders_amounts_non_negative` enforces independently in the database.
 *
 * @param subtotalMinor Order subtotal in minor units.
 * @param percentOff Coupon percentage, as snapshotted on the coupon row.
 * @returns `discountMinor` and `totalMinor`, where
 *   `totalMinor === subtotalMinor - discountMinor` and both are >= 0.
 * @throws Error if either argument is not an integer.
 */
export function applyPercentDiscount(
  subtotalMinor: number,
  percentOff: number,
): { discountMinor: number; totalMinor: number } {
  const discountMinor = Math.min(percentOfMinor(subtotalMinor, percentOff), subtotalMinor);
  return { discountMinor, totalMinor: subtotalMinor - discountMinor };
}
