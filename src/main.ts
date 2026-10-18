import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { couponSettings } from './config/coupon.config';

async function bootstrap() {
  couponSettings(); // fail fast on a bad COUPON_N or COUPON_X
  const app = configureApp(await NestFactory.create(AppModule));
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
