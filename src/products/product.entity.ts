import { Check, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('products')
@Check('products_inventory_non_negative', '"inventory" >= 0')
@Check('products_unit_price_non_negative', '"unit_price_minor" >= 0')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** Minor units (cents). Integer everywhere; currency never touches a float. */
  @Column({ name: 'unit_price_minor', type: 'integer' })
  unitPriceMinor: number;

  @Column({ type: 'integer' })
  inventory: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
