import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CatalogAndCarts1792325195609 implements MigrationInterface {
  name = 'CatalogAndCarts1792325195609';

  private readonly productsTable = new Table({
    name: 'products',
    columns: [
      {
        name: 'id',
        type: 'uuid',
        isPrimary: true,
        isGenerated: true,
        generationStrategy: 'uuid',
        default: 'uuid_generate_v4()',
      },
      { name: 'name', type: 'character varying', length: '200', isNullable: false },
      // Minor units (cents). Integer everywhere; currency never touches a float.
      { name: 'unit_price_minor', type: 'integer', isNullable: false },
      { name: 'inventory', type: 'integer', isNullable: false },
      { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
      { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
    ],
    checks: [
      { name: 'products_inventory_non_negative', expression: '"inventory" >= 0' },
      { name: 'products_unit_price_non_negative', expression: '"unit_price_minor" >= 0' },
    ],
  });

  private readonly cartsTable = new Table({
    name: 'carts',
    columns: [
      {
        name: 'id',
        type: 'uuid',
        isPrimary: true,
        isGenerated: true,
        generationStrategy: 'uuid',
        default: 'uuid_generate_v4()',
      },
      { name: 'status', type: 'character varying', length: '20', isNullable: false, default: "'open'" },
      { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
      { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
    ],
    checks: [{ name: 'carts_status_valid', expression: `"status" IN ('open', 'checked_out')` }],
  });

  private readonly cartItemsTable = new Table({
    name: 'cart_items',
    columns: [
      {
        name: 'id',
        type: 'uuid',
        isPrimary: true,
        isGenerated: true,
        generationStrategy: 'uuid',
        default: 'uuid_generate_v4()',
      },
      { name: 'cart_id', type: 'uuid', isNullable: false },
      { name: 'product_id', type: 'uuid', isNullable: false },
      { name: 'quantity', type: 'integer', isNullable: false },
    ],
    checks: [{ name: 'cart_items_quantity_positive', expression: '"quantity" > 0' }],
    // One row per product per cart: adding the same product twice adjusts quantity.
    indices: [
      { name: 'cart_items_cart_product_unique', columnNames: ['cart_id', 'product_id'], isUnique: true },
    ],
    foreignKeys: [
      {
        name: 'cart_items_cart_fk',
        columnNames: ['cart_id'],
        referencedTableName: 'carts',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      },
      {
        name: 'cart_items_product_fk',
        columnNames: ['product_id'],
        referencedTableName: 'products',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      },
    ],
  });

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No builder API for extensions; uuid_generate_v4() lives in uuid-ossp.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.createTable(this.productsTable);
    await queryRunner.createTable(this.cartsTable);
    await queryRunner.createTable(this.cartItemsTable);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable(this.cartItemsTable);
    await queryRunner.dropTable(this.cartsTable);
    await queryRunner.dropTable(this.productsTable);
  }
}
