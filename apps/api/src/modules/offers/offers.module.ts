import { Module } from '@nestjs/common';

import { SellersModule } from '../sellers/sellers.module';
import { OffersController } from './offers.controller';
import { OfferRepository } from './offers.repository';
import { OffersService } from './offers.service';

@Module({
  imports: [SellersModule],
  controllers: [OffersController],
  providers: [OffersService, OfferRepository],
  exports: [OffersService],
})
export class OffersModule {}
