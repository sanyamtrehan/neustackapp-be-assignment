import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Cart } from '../carts/cart.entity';
import { Coupon } from '../coupons/coupon.entity';
import { OrderItem } from './order-item.entity';

@Entity('orders')
@Check('orders_amounts_non_negative', '"subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "total_minor" >= 0')
@Check('orders_total_is_subtotal_less_discount', '"total_minor" = "subtotal_minor" - "discount_minor"')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The OneToOne below makes this UNIQUE: a cart produces exactly one order, ever. */
  @Column({ name: 'cart_id', type: 'uuid' })
  cartId: string;

  @OneToOne(() => Cart, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'cart_id' })
  cart: Cart;

  @Column({ name: 'subtotal_minor', type: 'integer' })
  subtotalMinor: number;

  @Column({ name: 'discount_minor', type: 'integer', default: 0 })
  discountMinor: number;

  @Column({ name: 'total_minor', type: 'integer' })
  totalMinor: number;

  /** UNIQUE: a second guard against one coupon paying for two orders. */
  @Column({ name: 'coupon_id', type: 'uuid', nullable: true, unique: true })
  couponId: string | null;

  @ManyToOne(() => Coupon, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'coupon_id' })
  coupon: Coupon | null;

  @OneToMany(() => OrderItem, (item) => item.order)
  items: OrderItem[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
