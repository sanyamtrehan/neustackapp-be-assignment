import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { couponSettings } from './config/coupon.config';
import { mountApiDocs } from './openapi';

async function bootstrap() {
  couponSettings(); // fail fast on a bad COUPON_N or COUPON_X
  const app = configureApp(await NestFactory.create(AppModule));
  mountApiDocs(app);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`API docs on http://localhost:${port}/docs`);
}
void bootstrap();
