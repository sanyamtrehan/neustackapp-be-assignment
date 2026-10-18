import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CouponTotalsView, ProductSalesView, ReportView } from './report.view';

/**
 * Postgres returns bigint as a string, because it can exceed a JS number.
 * Money here is minor units well inside the safe range, so converting is
 * fine; doing it in one place keeps the string from leaking into the API.
 */
function toNumber(value: string | number | null): number {
  return Number(value ?? 0);
}

@Injectable()
export class ReportsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Summarises everything sold and every coupon issued.
   *
   * Derived entirely from the orders and coupons tables on each call. There
   * is no stored counter to drift out of step with the rows, and nothing is
   * written, so calling it repeatedly cannot change an answer.
   *
   * The three queries run in one REPEATABLE READ transaction so they share a
   * single view of the data. Left to their own snapshots, a checkout
   * committing between them would be counted by one query and not another,
   * and the response would disagree with itself.
   *
   * @returns Order and revenue totals, per-product quantities, coupon counts.
   */
  async build(): Promise<ReportView> {
    return this.dataSource.transaction('REPEATABLE READ', (manager) => this.readAll(manager));
  }

  private async readAll(manager: EntityManager): Promise<ReportView> {
    const [totals] = (await manager.query(`
      SELECT count(*)::int                            AS orders_placed,
             coalesce(sum("subtotal_minor"), 0)       AS gross_minor,
             coalesce(sum("discount_minor"), 0)       AS discounts_minor,
             coalesce(sum("total_minor"), 0)          AS net_minor
        FROM "orders"
    `)) as Record<string, string | number>[];

    // Grouped by product id, not by name: a product renamed between two
    // orders is still one product. The name shown is the most recent
    // snapshot, so the report reads like the catalog the customer saw last.
    const productSales = (await manager.query(`
      SELECT oi."product_id"                                                  AS product_id,
             (array_agg(oi."product_name" ORDER BY o."created_at" DESC))[1]   AS name,
             sum(oi."quantity")::int                                          AS quantity,
             sum(oi."line_total_minor")                                       AS gross_minor
        FROM "order_items" oi
        JOIN "orders" o ON o."id" = oi."order_id"
       GROUP BY oi."product_id"
       ORDER BY name
    `)) as Record<string, string | number>[];

    const [coupons] = (await manager.query(`
      SELECT count(*)::int                                            AS generated,
             count(*) FILTER (WHERE "status" = 'available')::int       AS available,
             count(*) FILTER (WHERE "status" = 'redeemed')::int        AS redeemed
        FROM "coupons"
    `)) as Record<string, number>[];

    return {
      ordersPlaced: toNumber(totals.orders_placed),
      grossRevenueMinor: toNumber(totals.gross_minor),
      discountsGrantedMinor: toNumber(totals.discounts_minor),
      netRevenueMinor: toNumber(totals.net_minor),
      productSales: productSales.map(
        (row): ProductSalesView => ({
          productId: String(row.product_id),
          name: String(row.name),
          quantity: toNumber(row.quantity),
          grossRevenueMinor: toNumber(row.gross_minor),
        }),
      ),
      coupons: coupons as unknown as CouponTotalsView,
    };
  }
}
