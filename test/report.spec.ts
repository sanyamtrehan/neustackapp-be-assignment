import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import {
  BEANS,
  ControllablePaymentProvider,
  SCARCE_PRODUCT,
  countRows,
  createTestApp,
  resetDatabase,
} from './harness';

describe('admin report', () => {
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
  const report = () => request(server()).get('/admin/report');

  /**
   * Places a real order through the API, so the report is tested against data
   * the service itself produced rather than rows inserted by the test.
   *
   * @param expectedStatus Status the checkout must return.
   */
  const buy = async (
    productId: string,
    quantity: number,
    expectedStatus = 201,
    couponCode?: string,
  ) => {
    const { body: cart } = await request(server()).post('/carts').expect(201);
    await request(server())
      .post(`/carts/${cart.id}/items`)
      .send({ productId, quantity })
      .expect(201);
    return request(server())
      .post(`/carts/${cart.id}/checkout`)
      .send(couponCode ? { couponCode } : {})
      .expect(expectedStatus);
  };

  it('reports zeroes before anything is sold', async () => {
    const { body } = await report().expect(200);
    expect(body).toEqual({
      ordersPlaced: 0,
      grossRevenueMinor: 0,
      discountsGrantedMinor: 0,
      netRevenueMinor: 0,
      productSales: [],
      coupons: { generated: 0, available: 0, redeemed: 0 },
    });
  });

  it('reconciles with the orders and coupons the API itself returned', async () => {
    const placed = [];
    for (let i = 0; i < 5; i += 1) {
      placed.push((await buy(BEANS.id, 1)).body);
    }
    const { body: coupon } = await request(server()).post('/admin/coupons').expect(201);
    placed.push((await buy(SCARCE_PRODUCT.id, 2, 201, coupon.code)).body);

    const { body } = await report().expect(200);

    // Every total is the sum of what the order endpoints themselves reported.
    expect(body.ordersPlaced).toBe(placed.length);
    expect(body.grossRevenueMinor).toBe(placed.reduce((sum, o) => sum + o.subtotalMinor, 0));
    expect(body.discountsGrantedMinor).toBe(placed.reduce((sum, o) => sum + o.discountMinor, 0));
    expect(body.netRevenueMinor).toBe(placed.reduce((sum, o) => sum + o.totalMinor, 0));
    expect(body.netRevenueMinor).toBe(body.grossRevenueMinor - body.discountsGrantedMinor);

    expect(body.productSales).toEqual([
      {
        productId: BEANS.id,
        name: BEANS.name,
        quantity: 5,
        grossRevenueMinor: BEANS.unitPriceMinor * 5,
      },
      {
        productId: SCARCE_PRODUCT.id,
        name: SCARCE_PRODUCT.name,
        quantity: 2,
        grossRevenueMinor: SCARCE_PRODUCT.unitPriceMinor * 2,
      },
    ]);
    expect(body.coupons).toEqual({ generated: 1, available: 0, redeemed: 1 });
  });

  it('counts nothing from checkouts that failed', async () => {
    await buy(BEANS.id, 1);
    const before = await report().expect(200);

    // A declined payment, and a cart asking for more than exists.
    payments.declineNext = true;
    await buy(BEANS.id, 3, 402);
    payments.declineNext = false;
    await buy(SCARCE_PRODUCT.id, SCARCE_PRODUCT.inventory + 5, 409);

    const after = await report().expect(200);
    expect(after.body).toEqual(before.body);
  });

  it('changes nothing when called repeatedly', async () => {
    await buy(BEANS.id, 2);
    const rowsBefore = {
      orders: await countRows(app, 'orders'),
      orderItems: await countRows(app, 'order_items'),
      coupons: await countRows(app, 'coupons'),
      carts: await countRows(app, 'carts'),
    };

    const responses = await Promise.all([report(), report(), report()]);

    expect(responses.map((response) => response.body)).toEqual([
      responses[0].body,
      responses[0].body,
      responses[0].body,
    ]);
    expect({
      orders: await countRows(app, 'orders'),
      orderItems: await countRows(app, 'order_items'),
      coupons: await countRows(app, 'coupons'),
      carts: await countRows(app, 'carts'),
    }).toEqual(rowsBefore);
  });

  // The report answers with several queries. If they do not share one view of
  // the data, a checkout committing between them makes the response disagree
  // with itself: per-product revenue that the order totals do not account for.
  it('stays internally consistent while orders are being placed', async () => {
    const coupon = await (async () => {
      for (let i = 0; i < 5; i += 1) await buy(BEANS.id, 1);
      const { body } = await request(server()).post('/admin/coupons').expect(201);
      return body.code;
    })();

    // Checkouts and report reads, all in flight together.
    const work: Promise<unknown>[] = [];
    for (let i = 0; i < 15; i += 1) {
      work.push(buy(BEANS.id, 1));
    }
    work.push(buy(SCARCE_PRODUCT.id, 1, 201, coupon));
    const reads: Promise<request.Response>[] = [];
    for (let i = 0; i < 15; i += 1) {
      reads.push(report().expect(200));
    }
    work.push(...reads);
    await Promise.all(work);

    for (const response of await Promise.all(reads)) {
      const body = response.body;
      const productTotal = body.productSales.reduce(
        (sum: number, line: { grossRevenueMinor: number }) => sum + line.grossRevenueMinor,
        0,
      );

      expect(body.netRevenueMinor).toBe(body.grossRevenueMinor - body.discountsGrantedMinor);
      // Every sold line belongs to a counted order, and vice versa.
      expect(productTotal).toBe(body.grossRevenueMinor);
      expect(body.coupons.redeemed).toBeLessThanOrEqual(body.ordersPlaced);
    }
  });

  it('reports a renamed product once, under the name it last sold as', async () => {
    await buy(BEANS.id, 1);
    await app
      .get(DataSource)
      .query('UPDATE "products" SET "name" = $1 WHERE "id" = $2', ['Rebranded Beans', BEANS.id]);
    await buy(BEANS.id, 2);

    const { body } = await report().expect(200);

    expect(body.productSales).toHaveLength(1);
    expect(body.productSales[0]).toMatchObject({
      productId: BEANS.id,
      name: 'Rebranded Beans',
      quantity: 3,
    });
  });
});
