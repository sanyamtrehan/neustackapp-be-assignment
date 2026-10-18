import { Controller, HttpStatus, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ApiError } from '../common/api-error';
import { OrderView } from './order.view';
import { OrdersService } from './orders.service';

@ApiTags('checkout')
@Controller('carts')
export class CheckoutController {
  constructor(private readonly orders: OrdersService) {}

  /**
   * `POST /carts/:cartId/checkout` — turns a cart into an order.
   *
   * Idempotent per cart. The first request returns 201 with the new order;
   * any retry returns 200 with that same order, so a client that lost the
   * response can repeat the call safely and tell the two apart.
   *
   * @returns 201 created, or 200 on replay.
   *   400 `CART_EMPTY`, 404 `CART_NOT_FOUND`,
   *   409 `INSUFFICIENT_INVENTORY`, 402 `PAYMENT_FAILED`.
   */
  @ApiResponse({ status: 201, type: OrderView, description: 'Order created' })
  @ApiResponse({ status: 200, type: OrderView, description: 'Replay of an earlier checkout for this cart' })
  @ApiResponse({ status: 400, type: ApiError, description: 'CART_EMPTY' })
  @ApiResponse({ status: 402, type: ApiError, description: 'PAYMENT_FAILED, nothing was claimed' })
  @ApiResponse({ status: 404, type: ApiError, description: 'CART_NOT_FOUND' })
  @ApiResponse({ status: 409, type: ApiError, description: 'INSUFFICIENT_INVENTORY' })
  @Post(':cartId/checkout')
  async checkout(
    @Param('cartId', ParseUUIDPipe) cartId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OrderView> {
    const { order, replayed } = await this.orders.checkout(cartId);
    response.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return order;
  }
}
