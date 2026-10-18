import { IsInt, IsUUID, Max, Min } from 'class-validator';

/**
 * Upper bound per line. Arbitrary but deliberate: it keeps quantity * unit
 * price inside the integer money columns and stops a typo ordering a million
 * mugs. Enforced on the resulting quantity, not just the increment.
 */
export const MAX_CART_ITEM_QUANTITY = 10_000;

export class AddCartItemDto {
  @IsUUID()
  productId: string;

  // No @Type(() => Number): JSON already delivers numbers, and coercing first
  // made @IsInt see Number(true) = 1 and Number('0x5') = 5 as valid.
  @IsInt()
  @Min(1)
  @Max(MAX_CART_ITEM_QUANTITY)
  quantity: number;
}

export class UpdateCartItemDto {
  @IsInt()
  @Min(1)
  @Max(MAX_CART_ITEM_QUANTITY)
  quantity: number;
}
