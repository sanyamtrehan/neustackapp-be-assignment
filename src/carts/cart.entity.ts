import { Check, Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { CartItem } from './cart-item.entity';

export const CART_STATUSES = ['open', 'checked_out'] as const;
export type CartStatus = (typeof CART_STATUSES)[number];

@Entity('carts')
@Check('carts_status_valid', "\"status\" IN ('open', 'checked_out')")
export class Cart {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // varchar + CHECK rather than a Postgres enum type: adding a status later is
  // a one-line constraint swap instead of an ALTER TYPE dance.
  @Column({ type: 'varchar', length: 20, default: 'open' })
  status: CartStatus;

  @OneToMany(() => CartItem, (item) => item.cart)
  items: CartItem[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
