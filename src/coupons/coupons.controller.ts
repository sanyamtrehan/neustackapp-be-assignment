import { Controller, Post } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiError } from '../common/api-error';
import { CouponView } from './coupon.view';
import { CouponsService } from './coupons.service';

/**
 * Administrative coupon operations.
 *
 * Authentication is out of scope for this exercise, so these are not
 * protected. In a real deployment they would sit behind an operator role;
 * they are grouped under /admin to make that boundary obvious.
 */
@ApiTags('admin')
@Controller('admin/coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  /**
   * `POST /admin/coupons` — generates the coupon for the lowest reached
   * milestone that has not been rewarded yet.
   *
   * Call it twice and it rewards the next milestone, never the same one
   * twice.
   *
   * @returns 201 with the new coupon and its code.
   *   409 `MILESTONE_NOT_REACHED` if too few orders exist,
   *   409 `MILESTONE_ALREADY_REWARDED` if every reached milestone has one.
   */
  @ApiResponse({ status: 201, type: CouponView, description: 'Coupon generated' })
  @ApiResponse({
    status: 409,
    type: ApiError,
    description: 'MILESTONE_NOT_REACHED or MILESTONE_ALREADY_REWARDED',
  })
  @Post()
  generate(): Promise<CouponView> {
    return this.coupons.generate();
  }
}
