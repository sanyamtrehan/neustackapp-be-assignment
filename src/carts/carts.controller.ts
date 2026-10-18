import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { CartsService } from './carts.service';
import { CartView } from './cart.view';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart-item.dto';

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

  @Post(':cartId/items')
  addItem(
    @Param('cartId', ParseUUIDPipe) cartId: string,
    @Body() body: AddCartItemDto,
  ): Promise<CartView> {
    return this.carts.addItem(cartId, body.productId, body.quantity);
  }

  @Put(':cartId/items/:productId')
  setItemQuantity(
    @Param('cartId', ParseUUIDPipe) cartId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: UpdateCartItemDto,
  ): Promise<CartView> {
    return this.carts.setItemQuantity(cartId, productId, body.quantity);
  }

  @Delete(':cartId/items/:productId')
  removeItem(
    @Param('cartId', ParseUUIDPipe) cartId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<CartView> {
    return this.carts.removeItem(cartId, productId);
  }
}
