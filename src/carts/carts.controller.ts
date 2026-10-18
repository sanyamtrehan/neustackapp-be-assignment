import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiError } from '../common/api-error';
import { CartsService } from './carts.service';
import { CartView } from './cart.view';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart-item.dto';

/**
 * Customer-facing cart endpoints. None of these are administrative.
 *
 * Every route returns the full cart view, so a client can render from the
 * response instead of re-fetching. Path ids are validated as UUIDs before any
 * handler runs; bodies are validated by their DTOs, and unknown fields are
 * rejected rather than ignored.
 */
@ApiTags('carts')
@Controller('carts')
export class CartsController {
  constructor(private readonly carts: CartsService) {}

  /**
   * `POST /carts` — opens a cart.
   *
   * @returns 201 with an empty open cart.
   */
  @Post()
  create(): Promise<CartView> {
    return this.carts.create();
  }

  /**
   * `GET /carts/:cartId` — reads a cart, priced against the current catalog.
   *
   * @returns 200 with lines, line totals and subtotal.
   *   400 if `cartId` is not a UUID, 404 `CART_NOT_FOUND`.
   */
  @ApiResponse({ status: 404, type: ApiError, description: 'CART_NOT_FOUND' })
  @Get(':cartId')
  view(@Param('cartId', ParseUUIDPipe) cartId: string): Promise<CartView> {
    return this.carts.view(cartId);
  }

  /**
   * `POST /carts/:cartId/items` — adds a product, or raises its quantity if
   * the cart already holds it.
   *
   * A quantity beyond available stock is accepted here; inventory is claimed
   * at checkout.
   *
   * @param body `{ productId, quantity }`, quantity an integer 1..10000.
   * @returns 201 with the updated cart.
   *   400 for an invalid body, 404 `CART_NOT_FOUND` or `PRODUCT_NOT_FOUND`,
   *   409 `CART_ALREADY_CHECKED_OUT`.
   */
  @ApiResponse({ status: 400, type: ApiError, description: 'Invalid quantity or unknown field' })
  @ApiResponse({ status: 404, type: ApiError, description: 'CART_NOT_FOUND or PRODUCT_NOT_FOUND' })
  @ApiResponse({ status: 409, type: ApiError, description: 'CART_ALREADY_CHECKED_OUT' })
  @Post(':cartId/items')
  addItem(
    @Param('cartId', ParseUUIDPipe) cartId: string,
    @Body() body: AddCartItemDto,
  ): Promise<CartView> {
    return this.carts.addItem(cartId, body.productId, body.quantity);
  }

  /**
   * `PUT /carts/:cartId/items/:productId` — sets a line's quantity.
   *
   * Idempotent: repeating the request leaves the same quantity.
   *
   * @param body `{ quantity }`, an integer 1..10000. Use DELETE to remove a line.
   * @returns 200 with the updated cart.
   *   400 for an invalid body, 404 `CART_NOT_FOUND` or `CART_ITEM_NOT_FOUND`,
   *   409 `CART_ALREADY_CHECKED_OUT`.
   */
  @ApiResponse({ status: 400, type: ApiError, description: 'Invalid quantity or unknown field' })
  @ApiResponse({ status: 404, type: ApiError, description: 'CART_NOT_FOUND or CART_ITEM_NOT_FOUND' })
  @ApiResponse({ status: 409, type: ApiError, description: 'CART_ALREADY_CHECKED_OUT' })
  @Put(':cartId/items/:productId')
  setItemQuantity(
    @Param('cartId', ParseUUIDPipe) cartId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: UpdateCartItemDto,
  ): Promise<CartView> {
    return this.carts.setItemQuantity(cartId, productId, body.quantity);
  }

  /**
   * `DELETE /carts/:cartId/items/:productId` — removes a line.
   *
   * @returns 200 with the updated cart.
   *   404 `CART_NOT_FOUND` or `CART_ITEM_NOT_FOUND`,
   *   409 `CART_ALREADY_CHECKED_OUT`.
   */
  @ApiResponse({ status: 404, type: ApiError, description: 'CART_NOT_FOUND or CART_ITEM_NOT_FOUND' })
  @ApiResponse({ status: 409, type: ApiError, description: 'CART_ALREADY_CHECKED_OUT' })
  @Delete(':cartId/items/:productId')
  removeItem(
    @Param('cartId', ParseUUIDPipe) cartId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<CartView> {
    return this.carts.removeItem(cartId, productId);
  }
}
