import { Controller, HttpStatus, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { OrderView } from './order.view';
import { OrdersService } from './orders.service';

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
