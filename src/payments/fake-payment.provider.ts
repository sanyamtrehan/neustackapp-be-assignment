import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PaymentCharge, PaymentProvider, PaymentReceipt } from './payment.provider';

/**
 * Always approves. No real integration is required for this exercise, and a
 * fake that randomly declines would make tests flaky for no gain.
 *
 * Failure is exercised by substituting a declining provider for this one in
 * tests, which keeps the failure deterministic and under the test's control.
 */
@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  async charge(charge: PaymentCharge): Promise<PaymentReceipt> {
    return { reference: `fake_${charge.reference}_${randomUUID().slice(0, 8)}` };
  }
}
