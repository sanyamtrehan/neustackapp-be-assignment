import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { BEANS, SCARCE_PRODUCT, createTestApp, resetDatabase } from './harness';

const UNKNOWN_UUID = '99999999-9999-4999-8999-999999999999';

describe('carts', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => resetDatabase(app));
  afterAll(() => app.close());

  const newCart = async (): Promise<string> =>
    (await request(app.getHttpServer()).post('/carts').expect(201)).body.id;

  const addItem = (cartId: string, productId: string, quantity: number) =>
    request(app.getHttpServer()).post(`/carts/${cartId}/items`).send({ productId, quantity });

  it('creates an open, empty cart', async () => {
    const { body } = await request(app.getHttpServer()).post('/carts').expect(201);
    expect(body).toMatchObject({ status: 'open', items: [], subtotalMinor: 0 });
  });

  it('prices lines and the subtotal from the catalog', async () => {
    const cartId = await newCart();
    await addItem(cartId, BEANS.id, 2).expect(201);
    const { body } = await addItem(cartId, SCARCE_PRODUCT.id, 1).expect(201);

    expect(body.subtotalMinor).toBe(BEANS.unitPriceMinor * 2 + SCARCE_PRODUCT.unitPriceMinor);
    expect(body.items).toHaveLength(2);
  });

  // The chosen semantics: a cart is a selection, not a price quote.
  it('reflects a price change made after the item was added', async () => {
    const cartId = await newCart();
    await addItem(cartId, BEANS.id, 2).expect(201);

    await app
      .get(DataSource)
      .query('UPDATE "products" SET "unit_price_minor" = 3000 WHERE "id" = $1', [BEANS.id]);

    const { body } = await request(app.getHttpServer()).get(`/carts/${cartId}`).expect(200);
    expect(body.items[0].unitPriceMinor).toBe(3000);
    expect(body.subtotalMinor).toBe(6000);
  });

  it('adds to the quantity when the same product is added twice', async () => {
    const cartId = await newCart();
    await addItem(cartId, BEANS.id, 2).expect(201);
    const { body } = await addItem(cartId, BEANS.id, 3).expect(201);

    expect(body.items).toHaveLength(1);
    expect(body.items[0].quantity).toBe(5);
  });

  it('allows a quantity above available inventory, which checkout rejects later', async () => {
    const cartId = await newCart();
    const { body } = await addItem(cartId, SCARCE_PRODUCT.id, SCARCE_PRODUCT.inventory + 10).expect(201);
    expect(body.items[0].quantity).toBe(SCARCE_PRODUCT.inventory + 10);
  });

  describe('rejects invalid input before it reaches the database', () => {
    it.each([0, -1, 2.5, 10_001])('refuses quantity %p', async (quantity) => {
      const cartId = await newCart();
      await addItem(cartId, BEANS.id, quantity as number).expect(400);
    });

    it.each([true, '5', ' 7 ', '0x5', null, [3]])(
      'refuses a quantity of %p that is not a JSON integer',
      async (quantity) => {
        const cartId = await newCart();
        await addItem(cartId, BEANS.id, quantity as unknown as number).expect(400);
      },
    );

    it('refuses an add that would push the line past the cap', async () => {
      const cartId = await newCart();
      await addItem(cartId, BEANS.id, 10_000).expect(201);

      const { body } = await addItem(cartId, BEANS.id, 1).expect(400);
      expect(body.code).toBe('VALIDATION_FAILED');

      // The line is untouched by the refused add.
      const cart = await request(app.getHttpServer()).get(`/carts/${cartId}`).expect(200);
      expect(cart.body.items[0].quantity).toBe(10_000);
    });

    it('refuses a body larger than the server accepts', async () => {
      const cartId = await newCart();
      const { body } = await request(app.getHttpServer())
        .post(`/carts/${cartId}/items`)
        .send({ productId: BEANS.id, quantity: 1, note: 'A'.repeat(200_000) })
        .expect(413);
      expect(body.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('refuses an unknown product', async () => {
      const cartId = await newCart();
      const { body } = await addItem(cartId, UNKNOWN_UUID, 1).expect(404);
      expect(body.code).toBe('PRODUCT_NOT_FOUND');
    });

    it('refuses an unknown cart', async () => {
      const { body } = await addItem(UNKNOWN_UUID, BEANS.id, 1).expect(404);
      expect(body.code).toBe('CART_NOT_FOUND');
    });

    it('gives validation failures the same shape as every other error', async () => {
      const cartId = await newCart();
      const { body } = await addItem(cartId, BEANS.id, 0).expect(400);

      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.message).toContain('quantity');
    });

    it('answers an unknown route with a coded error, not an html page', async () => {
      const { body } = await request(app.getHttpServer()).get('/no-such-route').expect(404);
      expect(body.code).toBe('NOT_FOUND');
    });

    it('refuses unknown fields in the body', async () => {
      const cartId = await newCart();
      await request(app.getHttpServer())
        .post(`/carts/${cartId}/items`)
        .send({ productId: BEANS.id, quantity: 1, unitPriceMinor: 1 })
        .expect(400);
    });
  });

  it('updates and removes a line', async () => {
    const cartId = await newCart();
    await addItem(cartId, BEANS.id, 2).expect(201);

    const updated = await request(app.getHttpServer())
      .put(`/carts/${cartId}/items/${BEANS.id}`)
      .send({ quantity: 7 })
      .expect(200);
    expect(updated.body.items[0].quantity).toBe(7);

    const removed = await request(app.getHttpServer())
      .delete(`/carts/${cartId}/items/${BEANS.id}`)
      .expect(200);
    expect(removed.body.items).toEqual([]);
    expect(removed.body.subtotalMinor).toBe(0);
  });

  describe('simultaneous edits of one cart', () => {
    it('keeps every unit when the same product is added four times at once', async () => {
      const cartId = await newCart();

      const responses = await Promise.all(
        Array.from({ length: 4 }, () => addItem(cartId, BEANS.id, 1)),
      );

      // Before the cart row lock, these raced: quantities were lost when two
      // adds read the same row, and the losing insert returned a 500.
      expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201]);

      const { body } = await request(app.getHttpServer()).get(`/carts/${cartId}`).expect(200);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].quantity).toBe(4);
    });

    // 20 is deliberately above the database connection pool size of 10. An
    // earlier version checked the product through a second pooled connection
    // while already holding one, and ten of these hung the service for good.
    it('answers twenty simultaneous adds without exhausting the connection pool', async () => {
      const cartIds = await Promise.all(Array.from({ length: 20 }, () => newCart()));

      const responses = await Promise.all(
        cartIds.map((cartId) => addItem(cartId, BEANS.id, 1)),
      );

      expect(responses.every((response) => response.status === 201)).toBe(true);
      // And the service still answers afterwards.
      await request(app.getHttpServer()).get('/admin/report').expect(200);
    });

    it('settles on one quantity when four different quantities are set at once', async () => {
      const cartId = await newCart();
      await addItem(cartId, BEANS.id, 1).expect(201);

      const responses = await Promise.all(
        [2, 5, 9, 14].map((quantity) =>
          request(app.getHttpServer())
            .put(`/carts/${cartId}/items/${BEANS.id}`)
            .send({ quantity }),
        ),
      );

      expect(responses.every((response) => response.status === 200)).toBe(true);
      const { body } = await request(app.getHttpServer()).get(`/carts/${cartId}`).expect(200);
      expect([2, 5, 9, 14]).toContain(body.items[0].quantity);
    });
  });

  it('refuses to touch a line that is not in the cart', async () => {
    const cartId = await newCart();
    const { body } = await request(app.getHttpServer())
      .delete(`/carts/${cartId}/items/${BEANS.id}`)
      .expect(404);
    expect(body.code).toBe('CART_ITEM_NOT_FOUND');
  });

  it('refuses every mutation once the cart is checked out', async () => {
    const cartId = await newCart();
    await addItem(cartId, BEANS.id, 1).expect(201);
    await app.get(DataSource).query(`UPDATE "carts" SET "status" = 'checked_out' WHERE "id" = $1`, [cartId]);

    const add = await addItem(cartId, SCARCE_PRODUCT.id, 1).expect(409);
    expect(add.body.code).toBe('CART_ALREADY_CHECKED_OUT');

    await request(app.getHttpServer()).put(`/carts/${cartId}/items/${BEANS.id}`).send({ quantity: 2 }).expect(409);
    await request(app.getHttpServer()).delete(`/carts/${cartId}/items/${BEANS.id}`).expect(409);
  });
});
