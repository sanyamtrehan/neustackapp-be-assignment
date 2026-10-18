import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Order } from './order.entity';

@Entity('order_items')
@Check('order_items_quantity_positive', '"quantity" > 0')
@Check('order_items_line_total_consistent', '"line_total_minor" = "unit_price_minor" * "quantity"')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id', foreignKeyConstraintName: 'order_items_order_fk' })
  order: Order;

  /** Plain column, not a foreign key: the order must still explain itself if the product is deleted. */
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  // Name and price are snapshots taken at checkout; renaming or repricing a
  // product must never change what a past order says the customer bought.
  @Column({ name: 'product_name', type: 'varchar', length: 200 })
  productName: string;

  @Column({ name: 'unit_price_minor', type: 'integer' })
  unitPriceMinor: number;

  @Column({ type: 'integer' })
  quantity: number;

  @Column({ name: 'line_total_minor', type: 'integer' })
  lineTotalMinor: number;
}
