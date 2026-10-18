export class ProductSalesView {
  productId: string;

  /** The name the product was most recently sold under. */
  name: string;

  /** Units successfully purchased across all orders. */
  quantity: number;

  /** Revenue from this product before any order discount, in minor units. */
  grossRevenueMinor: number;
}

export class CouponTotalsView {
  /** Coupons ever generated. */
  generated: number;

  /** Generated and not yet spent. */
  available: number;

  /** Spent on an order. */
  redeemed: number;
}

export class ReportView {
  /** Orders successfully placed. */
  ordersPlaced: number;

  /** Sum of order subtotals, before discounts, in minor units. */
  grossRevenueMinor: number;

  /** Sum of discounts granted, in minor units. */
  discountsGrantedMinor: number;

  /** grossRevenueMinor - discountsGrantedMinor. What was actually charged. */
  netRevenueMinor: number;

  /** Quantity and revenue per product, by product name. */
  productSales: ProductSalesView[];

  coupons: CouponTotalsView;
}
