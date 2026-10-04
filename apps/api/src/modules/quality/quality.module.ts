import { Module } from '@nestjs/common';
import type { AppEnv } from '@fa/config';

import { APP_ENV } from '../../common/config/config.module';
import {
  createScannerRegistry,
  SCANNER_REGISTRY,
} from '../../integrations/scanners/scanner-registry';
import { SellersModule } from '../sellers/sellers.module';
import { QualityController } from './quality.controller';
import { QualityService } from './quality.service';

/**
 * Quality-control module. The scanner fleet is config-driven (Phase 0.7):
 * scanners that are not provisioned simply drop out of the fleet.
 */
@Module({
  imports: [SellersModule],
  controllers: [QualityController],
  providers: [
    QualityService,
    {
      provide: SCANNER_REGISTRY,
      useFactory: (env: AppEnv) => createScannerRegistry(env),
      inject: [APP_ENV],
    },
  ],
  exports: [QualityService],
})
export class QualityModule {}
