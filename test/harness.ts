import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  PAYMENT_PROVIDER,
  PaymentCharge,
  PaymentDeclinedError,
  PaymentProvider,
  PaymentReceipt,
} from '../src/payments/payment.provider';

/**
 * Payment stub a test can steer. Flip `declineNext` to make the charge fail at
 * the point where inventory, and later a coupon, have already been claimed.
 */
export class ControllablePaymentProvider implements PaymentProvider {
  declineNext = false;
  charges: PaymentCharge[] = [];

  async charge(charge: PaymentCharge): Promise<PaymentReceipt> {
    this.charges.push(charge);
    if (this.declineNext) {
      throw new PaymentDeclinedError('Declined by test');
    }
    return { reference: `test_${charge.reference}` };
  }

  reset(): void {
    this.declineNext = false;
    this.charges = [];
  }
}

/**
 * The seeded catalog, restored before every test. Duplicated from the seed
 * migration on purpose: a migration is frozen once applied, while the fixture
 * a test asserts against should sit next to the tests.
 */
export const TEST_PRODUCTS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Espresso Beans 1kg', unitPriceMinor: 2400, inventory: 100 },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Pour Over Kettle', unitPriceMinor: 7950, inventory: 40 },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Burr Grinder', unitPriceMinor: 18999, inventory: 12 },
  { id: '44444444-4444-4444-8444-444444444444', name: 'Ceramic Dripper', unitPriceMinor: 3150, inventory: 60 },
  { id: '55555555-5555-4555-8555-555555555555', name: 'Limited Edition Mug', unitPriceMinor: 1250, inventory: 3 },
];

export const SCARCE_PRODUCT = TEST_PRODUCTS[4];
export const BEANS = TEST_PRODUCTS[0];

/**
 * Boots the real application, optionally with a steerable payment provider.
 *
 * @param payments Stub substituted for the fake provider, so a test can make
 *   the charge fail deliberately.
 */
export async function createTestApp(payments?: PaymentProvider): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (payments) {
    builder.overrideProvider(PAYMENT_PROVIDER).useValue(payments);
  }
  const app = configureApp((await builder.compile()).createNestApplication());
  await app.init();
  return app;
}

/** Counts rows, for assertions about what a batch of concurrent requests produced. */
export async function countRows(app: INestApplication, table: string): Promise<number> {
  const [row] = await app.get(DataSource).query(`SELECT count(*)::int AS count FROM "${table}"`);
  return row.count;
}

/** Reads one product's current inventory. */
export async function inventoryOf(app: INestApplication, productId: string): Promise<number> {
  const [row] = await app
    .get(DataSource)
    .query('SELECT "inventory" FROM "products" WHERE "id" = $1', [productId]);
  return row.inventory;
}

/** Clears everything transactional and puts the catalog back to known values. */
export async function resetDatabase(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  await dataSource.query(
    'TRUNCATE "order_items", "orders", "coupons", "cart_items", "carts" RESTART IDENTITY CASCADE',
  );
  for (const product of TEST_PRODUCTS) {
    await dataSource.query(
      `INSERT INTO "products" ("id", "name", "unit_price_minor", "inventory") VALUES ($1, $2, $3, $4)
       ON CONFLICT ("id") DO UPDATE SET "name" = $2, "unit_price_minor" = $3, "inventory" = $4`,
      [product.id, product.name, product.unitPriceMinor, product.inventory],
    );
  }
}

/**
 * Inserts `count` placed orders straight into the database.
 *
 * Fixture only: milestone generation counts rows in `orders`, and driving a
 * dozen real checkouts to reach a milestone would make these tests slow and
 * would test checkout twice. Tests that care about checkout place real ones.
 */
export async function placeOrders(app: INestApplication, count: number): Promise<void> {
  const dataSource = app.get(DataSource);
  for (let i = 0; i < count; i += 1) {
    const [cart] = await dataSource.query(
      `INSERT INTO "carts" ("status") VALUES ('checked_out') RETURNING "id"`,
    );
    await dataSource.query(
      `INSERT INTO "orders" ("cart_id", "subtotal_minor", "discount_minor", "total_minor")
       VALUES ($1, 1000, 0, 1000)`,
      [cart.id],
    );
  }
}

/** Reads a coupon's current status, to prove a failed checkout did not spend it. */
export async function couponStatus(app: INestApplication, code: string): Promise<string> {
  const [row] = await app
    .get(DataSource)
    .query('SELECT "status" FROM "coupons" WHERE "code" = $1', [code]);
  return row?.status;
}

/** Reads a coupon's stored percentage, to prove config changes do not reprice it. */
export async function couponPercent(app: INestApplication, code: string): Promise<number> {
  const [row] = await app
    .get(DataSource)
    .query('SELECT "percent_off" FROM "coupons" WHERE "code" = $1', [code]);
  return row?.percent_off;
}

export async function setInventory(app: INestApplication, productId: string, inventory: number): Promise<void> {
  await app.get(DataSource).query('UPDATE "products" SET "inventory" = $1 WHERE "id" = $2', [inventory, productId]);
}
