import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartsModule } from './carts/carts.module';
import { CouponsModule } from './coupons/coupons.module';
import { dataSourceOptions } from './data-source';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [TypeOrmModule.forRoot(dataSourceOptions), PaymentsModule, CartsModule, OrdersModule, CouponsModule],
})
export class AppModule {}
