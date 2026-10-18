import { INestApplication, ValidationPipe } from '@nestjs/common';

/**
 * Shared by main.ts and the test harness: tests must exercise the same
 * validation the real server applies, not a copy of it that can drift.
 */
export function configureApp(app: INestApplication): INestApplication {
  // Trust boundary: reject unknown fields outright rather than ignoring them.
  return app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
}
