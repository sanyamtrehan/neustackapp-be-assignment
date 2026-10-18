import { Controller, Get } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReportView } from './report.view';
import { ReportsService } from './reports.service';

@ApiTags('admin')
@Controller('admin/report')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /**
   * `GET /admin/report` — what was sold, what it earned, and where the
   * coupons went.
   *
   * Read only. Every number is recomputed from the orders and coupons
   * tables, so the report always reconciles with them and repeated calls
   * never change anything.
   *
   * @returns 200 with order totals, per-product quantities and coupon counts.
   */
  @ApiResponse({ status: 200, type: ReportView, description: 'Current totals' })
  @Get()
  build(): Promise<ReportView> {
    return this.reports.build();
  }
}
