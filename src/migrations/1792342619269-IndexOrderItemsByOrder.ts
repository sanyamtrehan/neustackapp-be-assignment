import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

/**
 * Postgres creates no index for a foreign key column. Every GET /orders/:id,
 * the end of every checkout and the report all look up order_items by
 * order_id, so without this each one scans the whole table.
 */
export class IndexOrderItemsByOrder1792342619269 implements MigrationInterface {
  name = 'IndexOrderItemsByOrder1792342619269';

  private readonly index = new TableIndex({
    name: 'order_items_order_idx',
    columnNames: ['order_id'],
  });

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createIndex('order_items', this.index);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('order_items', this.index);
  }
}
