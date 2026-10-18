import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  PaymentCharge,
  PaymentDeclinedError,
  PaymentProvider,
  PaymentReceipt,
} from './payment.provider';

/**
 * Approves every charge, unless FAKE_PAYMENT_DECLINE is set.
 *
 * No real integration is required for this exercise, and a fake that declined
 * at random would make tests flaky for no gain. The switch exists so the
 * rollback guarantee — a failed checkout returns the stock and the coupon —
 * can be demonstrated against a running server, not only in tests, which
 * substitute their own provider.
 */
@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  async charge(charge: PaymentCharge): Promise<PaymentReceipt> {
    if (process.env.FAKE_PAYMENT_DECLINE === 'true') {
      throw new PaymentDeclinedError('Declined because FAKE_PAYMENT_DECLINE is set');
    }
    return { reference: `fake_${charge.reference}_${randomUUID().slice(0, 8)}` };
  }
}
