import { ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { couponSettings } from '../config/coupon.config';
import { Coupon } from './coupon.entity';
import { CouponView, toCouponView } from './coupon.view';

/**
 * Advisory lock key for coupon generation. Any constant works; it only has to
 * be the same in every process.
 */
const COUPON_GENERATION_LOCK = 4711;

@Injectable()
export class CouponsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Generates the coupon for the lowest milestone that has been reached and
   * not yet rewarded.
   *
   * Lowest rather than highest, so no milestone is ever skipped: if 12 orders
   * exist with n = 5 and nothing has been generated, the first call rewards
   * milestone 5 and a second call rewards 10.
   *
   * @returns The new coupon, including the code to hand to a customer.
   * @throws ConflictException `MILESTONE_NOT_REACHED` when too few orders
   *   exist, or `MILESTONE_ALREADY_REWARDED` when every reached milestone
   *   already has a coupon.
   */
  async generate(): Promise<CouponView> {
    return this.dataSource.transaction(async (manager) => {
      // There is no row to lock: the coupon does not exist yet, and the order
      // count is an aggregate. An advisory lock serialises generation so two
      // administrators cannot both pick the same milestone, while
      // coupons_milestone_unique stays as the guarantee if this ever fails.
      await manager.query('SELECT pg_advisory_xact_lock($1)', [COUPON_GENERATION_LOCK]);

      const { milestoneInterval, percentOff } = couponSettings();
      const milestone = await this.nextUnrewardedMilestone(manager, milestoneInterval);

      const coupon = await manager.save(
        manager.create(Coupon, {
          code: this.newCode(milestone),
          percentOff,
          milestoneOrderCount: milestone,
          status: 'available',
        }),
      );
      return toCouponView(coupon);
    });
  }

  /**
   * The lowest reached milestone with no coupon yet.
   *
   * @throws ConflictException `MILESTONE_NOT_REACHED` or `MILESTONE_ALREADY_REWARDED`.
   */
  private async nextUnrewardedMilestone(
    manager: EntityManager,
    milestoneInterval: number,
  ): Promise<number> {
    const [{ count }] = (await manager.query(
      'SELECT count(*)::int AS count FROM "orders"',
    )) as { count: number }[];

    const highestReached = Math.floor(count / milestoneInterval) * milestoneInterval;
    if (highestReached === 0) {
      throw new ConflictException({
        code: 'MILESTONE_NOT_REACHED',
        message: `${count} orders placed; the first reward is at ${milestoneInterval}`,
        ordersPlaced: count,
        nextMilestone: milestoneInterval,
      });
    }

    const rewarded = new Set(
      (
        (await manager.query(
          'SELECT "milestone_order_count" AS milestone FROM "coupons"',
        )) as { milestone: number }[]
      ).map((row) => row.milestone),
    );

    for (let milestone = milestoneInterval; milestone <= highestReached; milestone += milestoneInterval) {
      if (!rewarded.has(milestone)) {
        return milestone;
      }
    }

    throw new ConflictException({
      code: 'MILESTONE_ALREADY_REWARDED',
      message: `Every milestone up to ${highestReached} already has a coupon`,
      ordersPlaced: count,
      nextMilestone: highestReached + milestoneInterval,
    });
  }

  /**
   * Builds a coupon code.
   *
   * The milestone is readable, but a random suffix is appended because a
   * coupon is a bearer token: `REWARD-5` alone would let anyone guess and
   * spend a reward that was not theirs.
   */
  private newCode(milestone: number): string {
    return `REWARD-${milestone}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }
}
