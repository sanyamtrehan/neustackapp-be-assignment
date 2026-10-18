import { IsOptional, IsString, Length } from 'class-validator';

export class CheckoutDto {
  /**
   * Coupon to redeem, if any. An invalid or already redeemed code fails the
   * whole checkout rather than silently charging full price.
   */
  @IsOptional()
  @IsString()
  @Length(1, 40)
  couponCode?: string;
}
