import { Module } from '@nestjs/common';
import type { AppEnv } from '@fa/config';
import type { PaymentProvider } from '@fa/domain';

import { APP_ENV } from '../../common/config/config.module';
import { PAYMENT_PROVIDERS } from '../../common/tokens';
import {
  DPO_PAYMENT_PROVIDER,
  DpoPaymentProvider,
} from '../../integrations/payments/dpo-payment-provider';
import { FakePaymentProvider } from '../../integrations/payments/fake-payment-provider';
import { ListingsModule } from '../listings/listings.module';
import { SellersModule } from '../sellers/sellers.module';
import { PaymentsController } from './payments.controller';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';

/**
 * Payments module (Phase 9) — the orchestrator + provider registry.
 *
 * The FAKE adapter is registered only when PAYMENTS_FAKE_PROVIDER=true
 * (dev/test); the DPO adapter is the structural seam for the real provider
 * (TODO(spec)). Service lookups are by provider code; unknown codes 404.
 */
@Module({
  imports: [SellersModule, ListingsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentsRepository,
    DpoPaymentProvider,
    FakePaymentProvider,
    {
      provide: DPO_PAYMENT_PROVIDER,
      useExisting: DpoPaymentProvider,
    },
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (env: AppEnv, dpo: DpoPaymentProvider, fake: FakePaymentProvider) => {
        const providers: PaymentProvider[] = [dpo];
        if (env.PAYMENTS_FAKE_PROVIDER) {
          providers.push(fake);
        }
        return providers;
      },
      inject: [APP_ENV, DpoPaymentProvider, FakePaymentProvider],
    },
  ],
  exports: [PaymentsService, PaymentsRepository, DPO_PAYMENT_PROVIDER],
})
export class PaymentsModule {}
