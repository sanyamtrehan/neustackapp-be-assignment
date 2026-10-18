import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import {
  BEANS,
  ControllablePaymentProvider,
  SCARCE_PRODUCT,
  countRows,
  createTestApp,
  inventoryOf,
  resetDatabase,
  setInventory,
} from './harness';

describe('checkout', () => {
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

  /** A cart holding `quantity` of one product, ready to check out. */
  const cartWith = async (productId: string, quantity: number): Promise<string> => {
    const { body } = await request(server()).post('/carts').expect(201);
    await request(server())
      .post(`/carts/${body.id}/items`)
      .send({ productId, quantity })
      .expect(201);
    return body.id;
  };

  const checkout = (cartId: string) => request(server()).post(`/carts/${cartId}/checkout`);

  describe('a single checkout', () => {
    it('creates an order, claims inventory and closes the cart', async () => {
      const cartId = await cartWith(BEANS.id, 2);

      const { body, status } = await checkout(cartId);

      expect(status).toBe(201);
      expect(body).toMatchObject({
        cartId,
        subtotalMinor: BEANS.unitPriceMinor * 2,
        discountMinor: 0,
        totalMinor: BEANS.unitPriceMinor * 2,
        couponCode: null,
      });
      expect(await inventoryOf(app, BEANS.id)).toBe(BEANS.inventory - 2);
      expect(payments.charges).toEqual([{ reference: cartId, amountMinor: BEANS.unitPriceMinor * 2 }]);
    });

    it('refuses an empty cart', async () => {
      const { body } = await request(server()).post('/carts').expect(201);
      const response = await checkout(body.id).expect(400);
      expect(response.body.code).toBe('CART_EMPTY');
    });

    it('refuses a cart asking for more than exists, and claims nothing', async () => {
      const cartId = await cartWith(SCARCE_PRODUCT.id, SCARCE_PRODUCT.inventory + 1);

      const { body } = await checkout(cartId).expect(409);

      expect(body.code).toBe('INSUFFICIENT_INVENTORY');
      expect(body.productId).toBe(SCARCE_PRODUCT.id);
      expect(await inventoryOf(app, SCARCE_PRODUCT.id)).toBe(SCARCE_PRODUCT.inventory);
      expect(await countRows(app, 'orders')).toBe(0);
    });

    it('keeps explaining the purchase after the product changes', async () => {
      const cartId = await cartWith(BEANS.id, 1);
      const { body: order } = await checkout(cartId).expect(201);

      await app
        .get(DataSource)
        .query('UPDATE "products" SET "name" = $1, "unit_price_minor" = 9999 WHERE "id" = $2', [
          'Renamed Beans',
          BEANS.id,
        ]);

      const { body } = await request(server()).get(`/orders/${order.id}`).expect(200);
      expect(body.items[0].name).toBe(BEANS.name);
      expect(body.items[0].unitPriceMinor).toBe(BEANS.unitPriceMinor);
      expect(body.totalMinor).toBe(BEANS.unitPriceMinor);
    });
  });

  describe('when payment fails', () => {
    it('returns the inventory and leaves the cart checkoutable', async () => {
      const cartId = await cartWith(SCARCE_PRODUCT.id, 2);
      payments.declineNext = true;

      const { body } = await checkout(cartId).expect(402);
      expect(body.code).toBe('PAYMENT_FAILED');

      // The whole transaction rolled back: stock is back and nothing was written.
      expect(await inventoryOf(app, SCARCE_PRODUCT.id)).toBe(SCARCE_PRODUCT.inventory);
      expect(await countRows(app, 'orders')).toBe(0);

      // And the customer can simply try again.
      payments.declineNext = false;
      await checkout(cartId).expect(201);
      expect(await inventoryOf(app, SCARCE_PRODUCT.id)).toBe(SCARCE_PRODUCT.inventory - 2);
    });
  });

  describe('repeated requests for the same cart', () => {
    it('replays the first order instead of creating a second', async () => {
      const cartId = await cartWith(SCARCE_PRODUCT.id, 2);

      const first = await checkout(cartId).expect(201);
      const retry = await checkout(cartId).expect(200);

      expect(retry.body.id).toBe(first.body.id);
      expect(await countRows(app, 'orders')).toBe(1);
      expect(await inventoryOf(app, SCARCE_PRODUCT.id)).toBe(SCARCE_PRODUCT.inventory - 2);
    });

    it('creates exactly one order when eight retries arrive at once', async () => {
      const cartId = await cartWith(SCARCE_PRODUCT.id, 2);

      const responses = await Promise.all(Array.from({ length: 8 }, () => checkout(cartId)));

      const created = responses.filter((response) => response.status === 201);
      const replayed = responses.filter((response) => response.status === 200);
      expect(created).toHaveLength(1);
      expect(replayed).toHaveLength(7);

      // Every caller got the same order, and inventory moved once.
      const orderIds = new Set(responses.map((response) => response.body.id));
      expect(orderIds.size).toBe(1);
      expect(await countRows(app, 'orders')).toBe(1);
      expect(await inventoryOf(app, SCARCE_PRODUCT.id)).toBe(SCARCE_PRODUCT.inventory - 2);
    });
  });

  describe('competing checkouts', () => {
    it('sells exactly the stock that exists and no more', async () => {
      await setInventory(app, SCARCE_PRODUCT.id, 3);
      const carts = await Promise.all(
        Array.from({ length: 10 }, () => cartWith(SCARCE_PRODUCT.id, 1)),
      );

      const responses = await Promise.all(carts.map((cartId) => checkout(cartId)));

      const sold = responses.filter((response) => response.status === 201);
      const rejected = responses.filter((response) => response.status === 409);
      expect(sold).toHaveLength(3);
      expect(rejected).toHaveLength(7);
      expect(rejected.every((response) => response.body.code === 'INSUFFICIENT_INVENTORY')).toBe(true);

      expect(await inventoryOf(app, SCARCE_PRODUCT.id)).toBe(0);
      expect(await countRows(app, 'orders')).toBe(3);
    });

    it('does not deadlock when carts share products in different orders', async () => {
      await setInventory(app, SCARCE_PRODUCT.id, 10);
      const build = async (first: string, second: string): Promise<string> => {
        const { body } = await request(server()).post('/carts').expect(201);
        await request(server()).post(`/carts/${body.id}/items`).send({ productId: first, quantity: 1 });
        await request(server()).post(`/carts/${body.id}/items`).send({ productId: second, quantity: 1 });
        return body.id;
      };

      const carts = await Promise.all([
        build(BEANS.id, SCARCE_PRODUCT.id),
        build(SCARCE_PRODUCT.id, BEANS.id),
        build(BEANS.id, SCARCE_PRODUCT.id),
        build(SCARCE_PRODUCT.id, BEANS.id),
      ]);

      const responses = await Promise.all(carts.map((cartId) => checkout(cartId)));

      expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201]);
      expect(await countRows(app, 'orders')).toBe(4);
    });
  });

  it('returns ORDER_NOT_FOUND for an unknown order', async () => {
    const { body } = await request(server())
      .get('/orders/99999999-9999-4999-8999-999999999999')
      .expect(404);
    expect(body.code).toBe('ORDER_NOT_FOUND');
  });
});
