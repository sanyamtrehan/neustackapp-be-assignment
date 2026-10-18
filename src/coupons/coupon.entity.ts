import { Check, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export const COUPON_STATUSES = ['available', 'redeemed'] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

@Entity('coupons')
@Check('coupons_status_valid', "\"status\" IN ('available', 'redeemed')")
@Check('coupons_percent_off_range', '"percent_off" > 0 AND "percent_off" <= 100')
export class Coupon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40, unique: true })
  code: string;

  /** Snapshot of COUPON_X at generation time: changing the config must not reprice issued coupons. */
  @Column({ name: 'percent_off', type: 'integer' })
  percentOff: number;

  /** The order count this coupon rewards. UNIQUE is what makes generation idempotent. */
  @Column({ name: 'milestone_order_count', type: 'integer', unique: true })
  milestoneOrderCount: number;

  @Column({ type: 'varchar', length: 20, default: 'available' })
  status: CouponStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
