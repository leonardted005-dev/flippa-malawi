import { Module } from '@nestjs/common';

import { AuctionsController } from './auctions.controller';
import { AuctionRepository } from './auctions.repository';
import { AuctionsService } from './auctions.service';

@Module({
  controllers: [AuctionsController],
  providers: [AuctionsService, AuctionRepository],
  // Exported so ListingsModule can materialise/cancel auctions on approval.
  exports: [AuctionRepository, AuctionsService],
})
export class AuctionsModule {}
