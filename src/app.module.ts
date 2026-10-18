import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { couponConfig } from './config/coupon.config';
import { dataSourceOptions } from './data-source';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [couponConfig] }),
    TypeOrmModule.forRoot(dataSourceOptions),
  ],
})
export class AppModule {}
