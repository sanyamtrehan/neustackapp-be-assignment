import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Cart } from '../carts/cart.entity';
import { Coupon } from '../coupons/coupon.entity';
import { OrderItem } from './order-item.entity';

@Entity('orders')
@Unique('orders_cart_unique', ['cartId'])
@Unique('orders_coupon_unique', ['couponId'])
@Check('orders_amounts_non_negative', '"subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "total_minor" >= 0')
@Check('orders_total_is_subtotal_less_discount', '"total_minor" = "subtotal_minor" - "discount_minor"')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** orders_cart_unique above: a cart produces exactly one order, ever. */
  @Column({ name: 'cart_id', type: 'uuid' })
  cartId: string;

  // ManyToOne rather than OneToOne: OneToOne emits an auto-named REL_ constraint,
  // and the uniqueness is already stated above under a name an error can mention.
  @ManyToOne(() => Cart, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'cart_id', foreignKeyConstraintName: 'orders_cart_fk' })
  cart: Cart;

  @Column({ name: 'subtotal_minor', type: 'integer' })
  subtotalMinor: number;

  @Column({ name: 'discount_minor', type: 'integer', default: 0 })
  discountMinor: number;

  @Column({ name: 'total_minor', type: 'integer' })
  totalMinor: number;

  /** orders_coupon_unique above: a second guard against one coupon paying for two orders. */
  @Column({ name: 'coupon_id', type: 'uuid', nullable: true })
  couponId: string | null;

  @ManyToOne(() => Coupon, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'coupon_id', foreignKeyConstraintName: 'orders_coupon_fk' })
  coupon: Coupon | null;

  @OneToMany(() => OrderItem, (item) => item.order)
  items: OrderItem[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
