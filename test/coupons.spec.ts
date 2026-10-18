import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  BEANS,
  ControllablePaymentProvider,
  countRows,
  couponPercent,
  couponStatus,
  createTestApp,
  inventoryOf,
  placeOrders,
  resetDatabase,
} from './harness';

describe('coupons', () => {
  let app: INestApplication;
  const payments = new ControllablePaymentProvider();

  beforeAll(async () => {
    app = await createTestApp(payments);
  });
  beforeEach(async () => {
    payments.reset();
    await resetDatabase(app);
  });
  afterAll(() => app.close());

  const server = () => app.getHttpServer();
  const generate = () => request(server()).post('/admin/coupons');

  const cartWith = async (productId: string, quantity: number): Promise<string> => {
    const { body } = await request(server()).post('/carts').expect(201);
    await request(server()).post(`/carts/${body.id}/items`).send({ productId, quantity }).expect(201);
    return body.id;
  };

  const checkout = (cartId: string, couponCode?: string) =>
    request(server())
      .post(`/carts/${cartId}/checkout`)
      .send(couponCode ? { couponCode } : {});

  describe('generation', () => {
    it('refuses before the first milestone is reached', async () => {
      await placeOrders(app, 4);
      const { body } = await generate().expect(409);
      expect(body).toMatchObject({ code: 'MILESTONE_NOT_REACHED', ordersPlaced: 4, nextMilestone: 5 });
    });

    it('rewards each milestone once, lowest first, never skipping one', async () => {
      await placeOrders(app, 12);

      const first = await generate().expect(201);
      const second = await generate().expect(201);
      const third = await generate().expect(409);

      expect(first.body.milestoneOrderCount).toBe(5);
      expect(second.body.milestoneOrderCount).toBe(10);
      expect(third.body.code).toBe('MILESTONE_ALREADY_REWARDED');
      expect(await countRows(app, 'coupons')).toBe(2);
    });

    it('generates each milestone once when administrators call at the same time', async () => {
      await placeOrders(app, 10);

      const responses = await Promise.all(Array.from({ length: 5 }, () => generate()));

      const created = responses.filter((response) => response.status === 201);
      expect(created).toHaveLength(2);
      // Numeric sort: the default one is lexicographic and puts 10 before 5.
      const milestones = created.map((r) => r.body.milestoneOrderCount).sort((a, b) => a - b);
      expect(milestones).toEqual([5, 10]);
      expect(responses.filter((response) => response.status === 409)).toHaveLength(3);
      expect(await countRows(app, 'coupons')).toBe(2);
    });

    it('keeps the rate a coupon was issued at when the configured rate changes', async () => {
      await placeOrders(app, 10);
      const first = await generate().expect(201);
      expect(first.body.percentOff).toBe(10);

      process.env.COUPON_X = '25';
      try {
        const second = await generate().expect(201);
        expect(second.body.percentOff).toBe(25);
        // The already-issued coupon keeps the rate it was created with.
        const reread = await request(server()).post('/admin/coupons').expect(409);
        expect(reread.body.code).toBe('MILESTONE_ALREADY_REWARDED');
        expect(await couponPercent(app, first.body.code)).toBe(10);
      } finally {
        process.env.COUPON_X = '10';
      }
    });
  });

  describe('redemption', () => {
    /** Places enough orders to earn one coupon, and returns its code. */
    const earnCoupon = async (): Promise<string> => {
      await placeOrders(app, 5);
      const { body } = await generate().expect(201);
      return body.code;
    };

    it('applies the discount and records the coupon on the order', async () => {
      const code = await earnCoupon();
      const cartId = await cartWith(BEANS.id, 1);

      const { body } = await checkout(cartId, code).expect(201);

      expect(body).toMatchObject({
        subtotalMinor: BEANS.unitPriceMinor,
        discountMinor: 240,
        totalMinor: 2160,
        couponCode: code,
      });
      expect(payments.charges.at(-1)?.amountMinor).toBe(2160);
      expect(await couponStatus(app, code)).toBe('redeemed');
    });

    it('accepts a code that was retyped in the wrong case or with spaces', async () => {
      const code = await earnCoupon();
      const cartId = await cartWith(BEANS.id, 1);

      const { body } = await checkout(cartId, `  ${code.toLowerCase()}  `).expect(201);
      expect(body.couponCode).toBe(code);
    });

    it('refuses an unknown or already redeemed code', async () => {
      const code = await earnCoupon();
      const first = await cartWith(BEANS.id, 1);
      await checkout(first, code).expect(201);

      const second = await cartWith(BEANS.id, 1);
      const reused = await checkout(second, code).expect(409);
      expect(reused.body.code).toBe('COUPON_NOT_AVAILABLE');

      const unknown = await checkout(second, 'NO-SUCH-CODE').expect(404);
      expect(unknown.body.code).toBe('COUPON_NOT_FOUND');
    });

    it('lets exactly one of two simultaneous checkouts spend the coupon', async () => {
      const code = await earnCoupon();
      const [cartA, cartB] = await Promise.all([cartWith(BEANS.id, 1), cartWith(BEANS.id, 1)]);

      const responses = await Promise.all([checkout(cartA, code), checkout(cartB, code)]);

      const won = responses.filter((response) => response.status === 201);
      const lost = responses.filter((response) => response.status === 409);
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0].body.code).toBe('COUPON_NOT_AVAILABLE');

      // One discounted order, and the loser paid nothing at all.
      expect(won[0].body.discountMinor).toBe(240);
      expect(await countRows(app, 'orders')).toBe(6); // 5 fixture orders + 1 real
      expect(await couponStatus(app, code)).toBe('redeemed');
    });

    it('ignores the coupon on a retry instead of changing a placed order', async () => {
      const code = await earnCoupon();
      const cartId = await cartWith(BEANS.id, 1);

      const first = await checkout(cartId, code).expect(201);
      const retry = await checkout(cartId).expect(200);

      expect(retry.body.id).toBe(first.body.id);
      expect(retry.body.discountMinor).toBe(240);
      expect(retry.body.couponCode).toBe(code);
    });
  });

  describe('when payment fails after the coupon is claimed', () => {
    it('returns the coupon to available and spends nothing', async () => {
      await placeOrders(app, 5);
      const { body: coupon } = await generate().expect(201);
      const cartId = await cartWith(BEANS.id, 2);
      payments.declineNext = true;

      const declined = await checkout(cartId, coupon.code).expect(402);
      expect(declined.body.code).toBe('PAYMENT_FAILED');

      // Invariant 4: a coupon claimed by a checkout that fails is not consumed.
      expect(await couponStatus(app, coupon.code)).toBe('available');
      expect(await inventoryOf(app, BEANS.id)).toBe(BEANS.inventory);
      expect(await countRows(app, 'orders')).toBe(5); // the fixture orders only

      // And it still works on the next attempt.
      payments.declineNext = false;
      const { body } = await checkout(cartId, coupon.code).expect(201);
      expect(body.couponCode).toBe(coupon.code);
      expect(await couponStatus(app, coupon.code)).toBe('redeemed');
    });
  });
});
