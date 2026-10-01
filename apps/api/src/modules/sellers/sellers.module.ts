import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';
import { SellersController } from './sellers.controller';
import { PayoutAccountRepository, SellerRepository, TierRepository } from './sellers.repository';
import { SellersService } from './sellers.service';

@Module({
  imports: [IdentityModule],
  controllers: [SellersController],
  providers: [SellersService, SellerRepository, TierRepository, PayoutAccountRepository],
  exports: [SellersService, SellerRepository],
})
export class SellersModule {}
