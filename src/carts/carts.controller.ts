import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CartsService } from './carts.service';
import { CartView } from './cart.view';

@Controller('carts')
export class CartsController {
  constructor(private readonly carts: CartsService) {}

  @Post()
  create(): Promise<CartView> {
    return this.carts.create();
  }

  @Get(':cartId')
  view(@Param('cartId', ParseUUIDPipe) cartId: string): Promise<CartView> {
    return this.carts.view(cartId);
  }
}
