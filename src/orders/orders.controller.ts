import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { OrderView } from './order.view';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /**
   * `GET /orders/:orderId` — reads an order.
   *
   * Line names and prices are the snapshot taken at checkout, so this keeps
   * explaining the purchase after the catalog changes.
   *
   * @returns 200 with the order. 400 if `orderId` is not a UUID,
   *   404 `ORDER_NOT_FOUND`.
   */
  @Get(':orderId')
  find(@Param('orderId', ParseUUIDPipe) orderId: string): Promise<OrderView> {
    return this.orders.findOrder(orderId);
  }
}
