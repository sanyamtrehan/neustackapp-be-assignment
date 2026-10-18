import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

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

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return app;
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

export async function setInventory(app: INestApplication, productId: string, inventory: number): Promise<void> {
  await app.get(DataSource).query('UPDATE "products" SET "inventory" = $1 WHERE "id" = $2', [inventory, productId]);
}
