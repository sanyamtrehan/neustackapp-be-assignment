import { MigrationInterface, QueryRunner, Table } from 'typeorm';

const uuidPrimaryKey = {
  name: 'id',
  type: 'uuid',
  isPrimary: true,
  isGenerated: true,
  generationStrategy: 'uuid' as const,
  default: 'uuid_generate_v4()',
};

export class OrdersAndCoupons1792325266961 implements MigrationInterface {
  name = 'OrdersAndCoupons1792325266961';

  private readonly couponsTable = new Table({
    name: 'coupons',
    columns: [
      uuidPrimaryKey,
      { name: 'code', type: 'character varying', length: '40', isNullable: false },
      // Snapshot of COUPON_X at generation time: config changes must not reprice issued coupons.
      { name: 'percent_off', type: 'integer', isNullable: false },
      { name: 'milestone_order_count', type: 'integer', isNullable: false },
      { name: 'status', type: 'character varying', length: '20', isNullable: false, default: "'available'" },
      { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
    ],
    uniques: [
      { name: 'coupons_code_unique', columnNames: ['code'] },
      // What makes administrator generation idempotent: one coupon per milestone, ever.
      { name: 'coupons_milestone_unique', columnNames: ['milestone_order_count'] },
    ],
    checks: [
      { name: 'coupons_status_valid', expression: `"status" IN ('available', 'redeemed')` },
      { name: 'coupons_percent_off_range', expression: '"percent_off" > 0 AND "percent_off" <= 100' },
    ],
  });

  private readonly ordersTable = new Table({
    name: 'orders',
    columns: [
      uuidPrimaryKey,
      { name: 'cart_id', type: 'uuid', isNullable: false },
      { name: 'subtotal_minor', type: 'integer', isNullable: false },
      { name: 'discount_minor', type: 'integer', isNullable: false, default: 0 },
      { name: 'total_minor', type: 'integer', isNullable: false },
      { name: 'coupon_id', type: 'uuid', isNullable: true },
      { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
    ],
    uniques: [
      // A cart produces exactly one order, ever. This is what makes retries safe.
      { name: 'orders_cart_unique', columnNames: ['cart_id'] },
      // Backstop against one coupon paying for two orders.
      { name: 'orders_coupon_unique', columnNames: ['coupon_id'] },
    ],
    checks: [
      {
        name: 'orders_amounts_non_negative',
        expression: '"subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "total_minor" >= 0',
      },
      {
        name: 'orders_total_is_subtotal_less_discount',
        expression: '"total_minor" = "subtotal_minor" - "discount_minor"',
      },
    ],
    foreignKeys: [
      {
        name: 'orders_cart_fk',
        columnNames: ['cart_id'],
        referencedTableName: 'carts',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      },
      {
        name: 'orders_coupon_fk',
        columnNames: ['coupon_id'],
        referencedTableName: 'coupons',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      },
    ],
  });

  private readonly orderItemsTable = new Table({
    name: 'order_items',
    columns: [
      uuidPrimaryKey,
      { name: 'order_id', type: 'uuid', isNullable: false },
      // Deliberately not a foreign key: the order must still explain itself
      // after the product is renamed, repriced or deleted.
      { name: 'product_id', type: 'uuid', isNullable: false },
      { name: 'product_name', type: 'character varying', length: '200', isNullable: false },
      { name: 'unit_price_minor', type: 'integer', isNullable: false },
      { name: 'quantity', type: 'integer', isNullable: false },
      { name: 'line_total_minor', type: 'integer', isNullable: false },
    ],
    checks: [
      { name: 'order_items_quantity_positive', expression: '"quantity" > 0' },
      {
        name: 'order_items_line_total_consistent',
        expression: '"line_total_minor" = "unit_price_minor" * "quantity"',
      },
    ],
    foreignKeys: [
      {
        name: 'order_items_order_fk',
        columnNames: ['order_id'],
        referencedTableName: 'orders',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      },
    ],
  });

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(this.couponsTable);
    await queryRunner.createTable(this.ordersTable);
    await queryRunner.createTable(this.orderItemsTable);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable(this.orderItemsTable);
    await queryRunner.dropTable(this.ordersTable);
    await queryRunner.dropTable(this.couponsTable);
  }
}
