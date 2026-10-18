import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartsModule } from './carts/carts.module';
import { dataSourceOptions } from './data-source';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [TypeOrmModule.forRoot(dataSourceOptions), PaymentsModule, CartsModule],
})
export class AppModule {}
