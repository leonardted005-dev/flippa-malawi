import { Module } from '@nestjs/common';

import { AuctionsModule } from '../auctions/auctions.module';
import { CatalogModule } from '../catalog/catalog.module';
import { SellersModule } from '../sellers/sellers.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ListingsController } from './listings.controller';
import { ListingRepository } from './listings.repository';
import { ListingsService } from './listings.service';

@Module({
  imports: [SellersModule, CatalogModule, UploadsModule, AuctionsModule],
  controllers: [ListingsController],
  providers: [ListingsService, ListingRepository],
  exports: [ListingsService],
})
export class ListingsModule {}
