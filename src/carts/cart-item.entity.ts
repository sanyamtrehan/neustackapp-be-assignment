import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Product } from '../products/product.entity';
import { Cart } from './cart.entity';

@Entity('cart_items')
// One row per product per cart: adding the same product twice adjusts quantity.
@Index('cart_items_cart_product_unique', ['cartId', 'productId'], { unique: true })
@Check('cart_items_quantity_positive', '"quantity" > 0')
export class CartItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'cart_id', type: 'uuid' })
  cartId: string;

  @ManyToOne(() => Cart, (cart) => cart.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cart_id', foreignKeyConstraintName: 'cart_items_cart_fk' })
  cart: Cart;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'cart_items_product_fk' })
  product: Product;

  @Column({ type: 'integer' })
  quantity: number;
}
