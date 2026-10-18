import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';

/**
 * Builds the OpenAPI document and serves it.
 *
 * `/docs` is the Scalar reference, with a request runner for trying calls
 * against this instance. `/openapi.json` is the raw document, for importing
 * into another client.
 *
 * @param app Application to describe and mount the routes on.
 */
export function mountApiDocs(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Checkout and Rewards Service')
      .setDescription(
        [
          'Carts, checkout, inventory and milestone discount coupons.',
          '',
          'Every failure returns `{ code, message }`. Branch on `code`; it is stable.',
          '',
          'Operations tagged **admin** are administrative. Authentication is out of',
          'scope for this exercise, so they are not protected — in a real deployment',
          'they would sit behind an operator role.',
        ].join('\n'),
      )
      .setVersion('1.0')
      .addTag('carts', 'Cart lifecycle. Customer facing.')
      .addTag('checkout', 'Turning a cart into an order. Idempotent per cart.')
      .addTag('orders', 'Reading placed orders.')
      .build(),
  );

  // Scalar is the only UI, so swagger-ui is not mounted at all; the raw
  // document is served directly for importing elsewhere.
  app.use('/openapi.json', (_req: unknown, res: { json: (body: unknown) => void }) =>
    res.json(document),
  );
  app.use('/docs', apiReference({ content: document, theme: 'purple' }));
}
