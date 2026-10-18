import { MigrationInterface, QueryRunner } from 'typeorm';

// Fixed ids so README examples, manual probing and tests can reference a
// product without a lookup round trip first.
const PRODUCTS = [
  ['11111111-1111-4111-8111-111111111111', 'Espresso Beans 1kg', 2400, 100],
  ['22222222-2222-4222-8222-222222222222', 'Pour Over Kettle', 7950, 40],
  ['33333333-3333-4333-8333-333333333333', 'Burr Grinder', 18999, 12],
  ['44444444-4444-4444-8444-444444444444', 'Ceramic Dripper', 3150, 60],
  // Deliberately scarce: the row inventory contention tests compete over.
  ['55555555-5555-4555-8555-555555555555', 'Limited Edition Mug', 1250, 3],
];

export class SeedProducts1792325309527 implements MigrationInterface {
  name = 'SeedProducts1792325309527';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [id, name, unitPriceMinor, inventory] of PRODUCTS) {
      await queryRunner.query(
        `INSERT INTO "products" ("id", "name", "unit_price_minor", "inventory")
         VALUES ($1, $2, $3, $4) ON CONFLICT ("id") DO NOTHING`,
        [id, name, unitPriceMinor, inventory],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "products" WHERE "id" = ANY($1)`, [PRODUCTS.map((p) => p[0])]);
  }
}
