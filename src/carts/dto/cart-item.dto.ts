import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

// Upper bound is arbitrary but deliberate: it keeps quantity * unit price
// inside the integer money columns and stops a typo ordering a million mugs.
const MAX_QUANTITY = 10_000;

export class AddCartItemDto {
  @IsUUID()
  productId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantity: number;
}

export class UpdateCartItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantity: number;
}
