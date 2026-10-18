import { Coupon } from './coupon.entity';
import { CouponStatus } from './coupon.entity';

export class CouponView {
  id: string;

  /** The code a customer supplies at checkout. */
  code: string;

  /** Percent off, snapshotted when the coupon was generated. */
  percentOff: number;

  /** The order count this coupon rewards, for example 5 or 10. */
  milestoneOrderCount: number;

  /** `available` until redeemed, then `redeemed`. */
  status: CouponStatus;

  createdAt: Date;
}

/** Maps a coupon row to the shape returned by the API. */
export function toCouponView(coupon: Coupon): CouponView {
  return {
    id: coupon.id,
    code: coupon.code,
    percentOff: coupon.percentOff,
    milestoneOrderCount: coupon.milestoneOrderCount,
    status: coupon.status,
    createdAt: coupon.createdAt,
  };
}
